/* ─────────────────────────────────────────────────────────────────
   auth-chat.js
   Client-side login/register + end-to-end encrypted chat.

   IMPORTANT SECURITY NOTE: the Worker (api-name.workers.dev) never
   sees plaintext messages and never sees private key material. Keys
   are generated in the browser with Web Crypto (ECDH P-256),
   exported to IndexedDB for persistence across reloads, and the
   private key is marked non-extractable where the browser supports
   it. The Worker only ever stores/relays ciphertext + IV.

   Update API_BASE below to your deployed Worker URL before using.
   ───────────────────────────────────────────────────────────────── */

const API_BASE = 'https://bariumana-website-api.mbqbnb.workers.dev'; // ← set this to your Worker's URL

const DB_NAME = 'bariumana-keys';
const DB_STORE = 'keys';

/* ---------------------------------------------------------------- */
/* IndexedDB: persist this browser's ECDH keypair across reloads    */
/* ---------------------------------------------------------------- */

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------------------------------------------------------- */
/* ECDH keypair management                                          */
/* ---------------------------------------------------------------- */

/**
 * Get (or create) this browser's persistent ECDH keypair, scoped per
 * username so switching accounts in the same browser doesn't mix keys.
 */
async function getOrCreateKeyPair(username) {
  const dbKey = `keypair:${username}`;
  const existing = await idbGet(dbKey);
  if (existing) {
    const privateKey = await crypto.subtle.importKey(
      'jwk', existing.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']
    );
    const publicKey = await crypto.subtle.importKey(
      'jwk', existing.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    return { privateKey, publicKey, publicJwk: existing.publicJwk };
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  await idbSet(dbKey, { publicJwk, privateJwk });
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk };
}

/** Derive a shared AES-GCM key between our private key and their public JWK. */
async function deriveSharedKey(myPrivateKey, theirPublicJwk) {
  const theirPublicKey = await crypto.subtle.importKey(
    'jwk', theirPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBuf(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------------------------------------------------------------- */
/* Auth API                                                          */
/* ---------------------------------------------------------------- */

const Auth = {
  getToken() { return localStorage.getItem('auth_token'); },
  getUsername() { return localStorage.getItem('auth_username'); },
  isLoggedIn() { return !!this.getToken(); },

  async register(username, password) {
    const res = await fetch(`${API_BASE}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed.');
    return data;
  },

  async login(username, password) {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');

    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_username', data.username);

    // Ensure this browser has a keypair and the server has our public key.
    const { publicJwk } = await getOrCreateKeyPair(data.username);
    await fetch(`${API_BASE}/api/register-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
      body: JSON.stringify({ publicKey: publicJwk }),
    });

    return data;
  },

  logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
  },

  authHeader() {
    const token = this.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },
};

/* ---------------------------------------------------------------- */
/* Chat API — E2E encryption happens entirely client-side            */
/* ---------------------------------------------------------------- */

const Chat = {
  _pubKeyCache: new Map(),

  async _getTheirPublicKey(username) {
    if (this._pubKeyCache.has(username)) return this._pubKeyCache.get(username);
    const res = await fetch(`${API_BASE}/api/public-key?user=${encodeURIComponent(username)}`, {
      headers: Auth.authHeader(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch that user\'s key.');
    this._pubKeyCache.set(username, data.publicKey);
    return data.publicKey;
  },

  async listUsers() {
    const res = await fetch(`${API_BASE}/api/users`, { headers: Auth.authHeader() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not list users.');
    return data.users;
  },

  /** Encrypt and send a message to `toUsername`. */
  async send(toUsername, plaintext) {
    const me = Auth.getUsername();
    const { privateKey } = await getOrCreateKeyPair(me);
    const theirPublicJwk = await this._getTheirPublicKey(toUsername);
    const sharedKey = await deriveSharedKey(privateKey, theirPublicJwk);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify({
        to: toUsername,
        ciphertext: bufToB64(ciphertextBuf),
        iv: bufToB64(iv),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send message.');
    return data;
  },

  /** Poll for new messages addressed to us since a given timestamp; decrypts them. */
  async poll(sinceTs = 0) {
    const me = Auth.getUsername();
    const { privateKey } = await getOrCreateKeyPair(me);

    const res = await fetch(`${API_BASE}/api/chat?since=${sinceTs}`, { headers: Auth.authHeader() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to poll messages.');

    const decrypted = [];
    for (const msg of data.messages) {
      try {
        const theirPublicJwk = await this._getTheirPublicKey(msg.from);
        const sharedKey = await deriveSharedKey(privateKey, theirPublicJwk);
        const plainBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: b64ToBuf(msg.iv) }, sharedKey, b64ToBuf(msg.ciphertext)
        );
        decrypted.push({ from: msg.from, ts: msg.ts, text: new TextDecoder().decode(plainBuf) });
      } catch (e) {
        decrypted.push({ from: msg.from, ts: msg.ts, text: '[could not decrypt — key mismatch]' });
      }
    }
    return { messages: decrypted, serverTime: data.serverTime };
  },
};

/* ---------------------------------------------------------------- */
/* Gated content fetch                                               */
/* ---------------------------------------------------------------- */

async function fetchPrivateContent(name) {
  const res = await fetch(`${API_BASE}/api/private-content?name=${encodeURIComponent(name)}`, {
    headers: Auth.authHeader(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load content.');
  }
  return res.text();
}

/* ---------------------------------------------------------------- */
/* Disclosed, aggregate-only visit beacon                            */
/* No IP, no headers, no fingerprinting — see Worker-side comment   */
/* in routes-analytics.js for exactly what is (and isn't) recorded. */
/* ---------------------------------------------------------------- */

function sendVisitBeacon() {
  try {
    const payload = JSON.stringify({
      referrer: document.referrer || '',
      device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API_BASE}/api/log`, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(`${API_BASE}/api/log`, { method: 'POST', body: payload, keepalive: true });
    }
  } catch (e) { /* analytics failures should never break the site */ }
}

/* ---------------------------------------------------------------- */
/* Site config — Worker-driven maintenance mode / feature flags.     */
/* Cached briefly client-side so it's cheap to call on every load    */
/* without slowing the page down.                                    */
/* ---------------------------------------------------------------- */

const SiteConfig = {
  _cache: null,
  _cachedAt: 0,
  DEFAULTS: {
    maintenanceMode: false,
    features: { chat: true, game: true, oracle: true },
  },

  async load({ force = false } = {}) {
    if (!force && this._cache && Date.now() - this._cachedAt < 60000) return this._cache;
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) throw new Error('config fetch failed');
      const data = await res.json();
      this._cache = { ...this.DEFAULTS, ...data };
    } catch (e) {
      // Worker unreachable or config missing — fail open with safe defaults
      // rather than breaking the whole site.
      this._cache = this.DEFAULTS;
    }
    this._cachedAt = Date.now();
    return this._cache;
  },
};

// Export to global scope for use by script.js / inline handlers.
window.Auth = Auth;
window.Chat = Chat;
window.SiteConfig = SiteConfig;
window.fetchPrivateContent = fetchPrivateContent;
window.sendVisitBeacon = sendVisitBeacon;