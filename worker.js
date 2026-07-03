// ═════════════════════════════════════════════════════════════════
// Bariumana API — single-file Cloudflare Worker
//
// This is the whole backend in one file, meant to be pasted directly
// into the Cloudflare dashboard's built-in code editor
// (Workers & Pages → your Worker → Edit code). No build step, no
// npm, no CLI required.
//
// Before deploying, set up (all via the dashboard, no terminal):
//   1. Four KV namespaces: AUTH_KV, CHAT_KV, CONTENT_KV, STATS_KV
//      (Workers & Pages → KV → Create a namespace)
//   2. Bind all four to this Worker
//      (this Worker → Settings → Variables and Bindings → KV Namespace Bindings)
//   3. Environment variables
//      (same Settings page → Environment Variables):
//        ALLOWED_ORIGIN      = https://your-username.github.io   (plain text)
//        SITE_NAME           = Bariumana                          (plain text)
//        JWT_SECRET          = <long random string>                (click "Encrypt")
//        TELEGRAM_BOT_TOKEN  = <from @BotFather>                   (click "Encrypt")
//        TELEGRAM_CHAT_ID    = <your Telegram chat id>              (click "Encrypt")
//   4. Cron trigger: Settings → Triggers → Cron Triggers → Add
//        0 */6 * * *   (every 6 hours)
//
// Full setup walkthrough is in the accompanying README.
// ═════════════════════════════════════════════════════════════════


/* ───────────────────────────────────────────────────────────────
   SECTION 1 — crypto & auth utilities
   ─────────────────────────────────────────────────────────────── */

const encoder = new TextEncoder();

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomSaltB64() {
  return bufToB64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

async function hashPassword(password, saltB64) {
  const saltBytes = b64urlToBuf(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufToB64url(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

async function createSessionToken(payload, secret) {
  const key = await importHmacKey(secret);
  const payloadB64 = bufToB64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return `${payloadB64}.${bufToB64url(sig)}`;
}

async function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC', key, b64urlToBuf(sigB64), encoder.encode(payloadB64)
  );
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBuf(payloadB64)));
  } catch {
    return null;
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function extractBearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function isValidUsername(name) {
  return typeof name === 'string' && /^[a-z0-9_]{3,24}$/.test(name);
}

async function requireAuth(request, env) {
  const token = extractBearer(request);
  if (!token) return null;
  const payload = await verifySessionToken(token, env.JWT_SECRET);
  if (!payload || !payload.username) return null;
  const exists = await env.AUTH_KV.get(`user:${payload.username}`);
  if (!exists) return null;
  return { username: payload.username };
}

async function bumpDailyStat(env, field, amount = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `stats:day:${day}`;
  const raw = await env.STATS_KV.get(key);
  const stats = raw ? JSON.parse(raw) : {};
  stats[field] = (stats[field] || 0) + amount;
  await env.STATS_KV.put(key, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 35 });
}


/* ───────────────────────────────────────────────────────────────
   SECTION 2 — HTTP / CORS helpers
   ─────────────────────────────────────────────────────────────── */

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, init = {}, origin) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...(init.headers || {}) },
  });
}

function textResponse(body, init = {}, origin) {
  return new Response(body, {
    status: init.status || 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(origin), ...(init.headers || {}) },
  });
}

function err(message, status = 400, origin) {
  return json({ error: message }, { status }, origin);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 3 — auth routes (register / login / keys)
   ─────────────────────────────────────────────────────────────── */

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h sessions

async function handleRegister(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body', 400, origin); }

  const { username, password } = body || {};
  if (!isValidUsername(username)) {
    return err('Username must be 3-24 chars: lowercase letters, digits, underscore.', 400, origin);
  }
  if (typeof password !== 'string' || password.length < 8) {
    return err('Password must be at least 8 characters.', 400, origin);
  }

  const existing = await env.AUTH_KV.get(`user:${username}`);
  if (existing) return err('That username is already taken.', 409, origin);

  const salt = randomSaltB64();
  const passwordHash = await hashPassword(password, salt);

  await env.AUTH_KV.put(`user:${username}`, JSON.stringify({
    passwordHash, salt, publicKeyJwk: null, createdAt: Date.now(),
  }));

  await bumpDailyStat(env, 'registrations');

  return json({ ok: true, message: 'Account created. You can log in now.' }, {}, origin);
}

async function handleLogin(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body', 400, origin); }

  const { username, password } = body || {};
  if (!isValidUsername(username) || typeof password !== 'string') {
    return err('Invalid credentials.', 400, origin);
  }

  const raw = await env.AUTH_KV.get(`user:${username}`);
  if (!raw) return err('Invalid username or password.', 401, origin);

  const user = JSON.parse(raw);
  const attemptedHash = await hashPassword(password, user.salt);

  if (!safeEqual(attemptedHash, user.passwordHash)) {
    return err('Invalid username or password.', 401, origin);
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await createSessionToken({ username, exp }, env.JWT_SECRET);

  await bumpDailyStat(env, 'logins');

  return json({ ok: true, token, username, exp }, {}, origin);
}

async function handleRegisterKey(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body', 400, origin); }

  const { publicKey } = body || {};
  if (!publicKey || typeof publicKey !== 'object') {
    return err('publicKey (JWK object) is required.', 400, origin);
  }

  const raw = await env.AUTH_KV.get(`user:${auth.username}`);
  const user = JSON.parse(raw);
  user.publicKeyJwk = publicKey;
  await env.AUTH_KV.put(`user:${auth.username}`, JSON.stringify(user));

  return json({ ok: true }, {}, origin);
}

async function handleGetPublicKey(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  const url = new URL(request.url);
  const targetUser = url.searchParams.get('user');
  if (!isValidUsername(targetUser)) return err('Invalid user id.', 400, origin);

  const raw = await env.AUTH_KV.get(`user:${targetUser}`);
  if (!raw) return err('No such user.', 404, origin);

  const user = JSON.parse(raw);
  if (!user.publicKeyJwk) return err('That user has not set up chat keys yet.', 404, origin);

  return json({ username: targetUser, publicKey: user.publicKeyJwk }, {}, origin);
}

async function handleListUsers(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  const list = await env.AUTH_KV.list({ prefix: 'user:' });
  const usernames = list.keys
    .map(k => k.name.slice('user:'.length))
    .filter(name => name !== auth.username);

  return json({ users: usernames }, {}, origin);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 4 — chat routes (E2E encrypted; Worker only relays ciphertext)
   ─────────────────────────────────────────────────────────────── */

const MESSAGE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_CIPHERTEXT_B64_LEN = 20000;

async function handleSendMessage(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON body', 400, origin); }

  const { to, ciphertext, iv } = body || {};
  if (!isValidUsername(to)) return err('Invalid recipient id.', 400, origin);
  if (typeof ciphertext !== 'string' || typeof iv !== 'string') {
    return err('ciphertext and iv (base64 strings) are required.', 400, origin);
  }
  if (ciphertext.length > MAX_CIPHERTEXT_B64_LEN) {
    return err('Message too large.', 413, origin);
  }

  const recipientExists = await env.AUTH_KV.get(`user:${to}`);
  if (!recipientExists) return err('No such recipient.', 404, origin);

  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  const key = `msg:${to}:${ts}:${rand}`;

  const record = { from: auth.username, to, ciphertext, iv, ts };
  await env.CHAT_KV.put(key, JSON.stringify(record), { expirationTtl: MESSAGE_TTL_SECONDS });

  await bumpDailyStat(env, 'messagesSent');

  return json({ ok: true, ts }, {}, origin);
}

async function handlePollMessages(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  const url = new URL(request.url);
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;

  const list = await env.CHAT_KV.list({ prefix: `msg:${auth.username}:` });

  const messages = [];
  for (const k of list.keys) {
    const parts = k.name.split(':');
    const ts = parseInt(parts[2], 10);
    if (ts <= since) continue;
    const raw = await env.CHAT_KV.get(k.name);
    if (raw) messages.push(JSON.parse(raw));
  }

  messages.sort((a, b) => a.ts - b.ts);

  return json({ messages, serverTime: Date.now() }, {}, origin);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 5 — gated private content
   ─────────────────────────────────────────────────────────────── */

async function handlePrivateContent(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name || !/^[a-z0-9_-]{1,64}$/i.test(name)) {
    return err('Invalid content name.', 400, origin);
  }

  const html = await env.CONTENT_KV.get(`private:${name}`);
  if (html === null) return err('Not found.', 404, origin);

  return textResponse(html, {}, origin);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 6 — DISCLOSED, aggregate-only visit analytics
   No IP storage, no per-visitor identity trail. See the site
   footer for the visitor-facing disclosure this pairs with.
   ─────────────────────────────────────────────────────────────── */

const MAX_TRACKED_REFERRERS = 20;

async function handleLogVisit(request, env, origin) {
  let body = {};
  try { body = await request.json(); } catch { /* beacon bodies can be empty */ }

  const day = new Date().toISOString().slice(0, 10);
  const key = `stats:day:${day}`;
  const raw = await env.STATS_KV.get(key);
  const stats = raw ? JSON.parse(raw) : {};

  stats.visits = (stats.visits || 0) + 1;

  const country = request.cf && request.cf.country ? request.cf.country : 'unknown';
  stats.countries = stats.countries || {};
  stats.countries[country] = (stats.countries[country] || 0) + 1;

  let refHost = 'direct';
  if (body.referrer) {
    try { refHost = new URL(body.referrer).hostname || 'direct'; } catch { /* ignore malformed */ }
  }
  stats.referrers = stats.referrers || {};
  const refKeys = Object.keys(stats.referrers);
  if (stats.referrers[refHost] !== undefined || refKeys.length < MAX_TRACKED_REFERRERS) {
    stats.referrers[refHost] = (stats.referrers[refHost] || 0) + 1;
  } else {
    stats.referrers['other'] = (stats.referrers['other'] || 0) + 1;
  }

  const device = body.device === 'mobile' ? 'mobile' : 'desktop';
  stats.devices = stats.devices || {};
  stats.devices[device] = (stats.devices[device] || 0) + 1;

  await env.STATS_KV.put(key, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 35 });

  return json({ ok: true }, { status: 202 }, origin);
}

async function handleGetStats(request, env, origin) {
  const auth = await requireAuth(request, env);
  if (!auth) return err('Not authenticated.', 401, origin);

  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10), 35);

  const results = {};
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = `stats:day:${d.toISOString().slice(0, 10)}`;
    const raw = await env.STATS_KV.get(key);
    if (raw) results[key.slice('stats:day:'.length)] = JSON.parse(raw);
  }

  return json({ stats: results }, {}, origin);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 7 — Telegram digest (scheduled, aggregate-only)
   ─────────────────────────────────────────────────────────────── */

function topEntries(obj, n = 5) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') || 'none';
}

function mergeDay(acc, day) {
  acc.visits += day.visits || 0;
  acc.registrations += day.registrations || 0;
  acc.logins += day.logins || 0;
  acc.messagesSent += day.messagesSent || 0;
  for (const [k, v] of Object.entries(day.countries || {})) acc.countries[k] = (acc.countries[k] || 0) + v;
  for (const [k, v] of Object.entries(day.referrers || {})) acc.referrers[k] = (acc.referrers[k] || 0) + v;
  for (const [k, v] of Object.entries(day.devices || {})) acc.devices[k] = (acc.devices[k] || 0) + v;
  return acc;
}

async function collectWindowStats(env, hours) {
  const acc = { visits: 0, registrations: 0, logins: 0, messagesSent: 0, countries: {}, referrers: {}, devices: {} };
  const days = Math.ceil(hours / 24) + 1;
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = `stats:day:${d.toISOString().slice(0, 10)}`;
    const raw = await env.STATS_KV.get(key);
    if (raw) mergeDay(acc, JSON.parse(raw));
  }
  return acc;
}

async function countTotalUsers(env) {
  let total = 0, cursor;
  do {
    const page = await env.AUTH_KV.list({ prefix: 'user:', cursor });
    total += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return total;
}

async function buildDigestMessage(env, windowHours = 6) {
  const stats = await collectWindowStats(env, windowHours);
  const totalUsers = await countTotalUsers(env);

  const lines = [
    `📊 *${env.SITE_NAME || 'Site'} — last ${windowHours}h digest*`,
    '',
    `👀 Visits: *${stats.visits}*`,
    `🌍 Top countries: ${topEntries(stats.countries)}`,
    `🔗 Top referrers: ${topEntries(stats.referrers)}`,
    `📱 Devices: ${topEntries(stats.devices)}`,
    '',
    `🆕 New registrations: *${stats.registrations}*`,
    `🔑 Logins: *${stats.logins}*`,
    `👥 Total registered users: *${totalUsers}*`,
    `💬 Messages sent (encrypted, content unreadable to server): *${stats.messagesSent}*`,
  ];

  return lines.join('\n');
}

async function sendTelegramMessage(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn('Telegram not configured — skipping digest send.');
    return;
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    console.error('Telegram send failed:', res.status, await res.text());
  }
}

async function runScheduledDigest(env) {
  const message = await buildDigestMessage(env, 6);
  await sendTelegramMessage(env, message);
}


/* ───────────────────────────────────────────────────────────────
   SECTION 8 — router (entry point)
   ─────────────────────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      switch (url.pathname) {
        case '/api/register':
          if (request.method !== 'POST') return err('Method not allowed', 405, origin);
          return await handleRegister(request, env, origin);

        case '/api/login':
          if (request.method !== 'POST') return err('Method not allowed', 405, origin);
          return await handleLogin(request, env, origin);

        case '/api/register-key':
          if (request.method !== 'POST') return err('Method not allowed', 405, origin);
          return await handleRegisterKey(request, env, origin);

        case '/api/public-key':
          if (request.method !== 'GET') return err('Method not allowed', 405, origin);
          return await handleGetPublicKey(request, env, origin);

        case '/api/users':
          if (request.method !== 'GET') return err('Method not allowed', 405, origin);
          return await handleListUsers(request, env, origin);

        case '/api/chat':
          if (request.method === 'POST') return await handleSendMessage(request, env, origin);
          if (request.method === 'GET') return await handlePollMessages(request, env, origin);
          return err('Method not allowed', 405, origin);

        case '/api/private-content':
          if (request.method !== 'GET') return err('Method not allowed', 405, origin);
          return await handlePrivateContent(request, env, origin);

        case '/api/log':
          if (request.method !== 'POST') return err('Method not allowed', 405, origin);
          return await handleLogVisit(request, env, origin);

        case '/api/stats':
          if (request.method !== 'GET') return err('Method not allowed', 405, origin);
          return await handleGetStats(request, env, origin);

        default:
          return err('Not found', 404, origin);
      }
    } catch (e) {
      console.error('Unhandled error:', e);
      return err('Internal error', 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledDigest(env));
  },
};