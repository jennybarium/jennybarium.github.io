/* ─────────────────────────────────────────────────────────────────
   account-ui.js
   Wires the account/login/chat panel markup to the Auth/Chat API
   defined in auth-chat.js. Follows the same open/close (.show class
   + scrim) convention used elsewhere on the site (script.js).
   ───────────────────────────────────────────────────────────────── */

let chatPollTimer = null;
let lastMessageTs = 0;
const seenMessageKeys = new Set();

function initAccountPanel(){
    const toggle = document.getElementById('accountToggle');
    const panel = document.getElementById('accountPanel');
    const scrim = document.getElementById('accountScrim');
    const closeBtn = document.getElementById('closeAccount');

    function open(){
        panel.classList.add('show');
        scrim.classList.add('show');
        panel.setAttribute('aria-hidden', 'false');
        refreshAccountView();
    }
    function close(){
        panel.classList.remove('show');
        scrim.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
    }

    toggle.addEventListener('click', () => {
        panel.classList.contains('show') ? close() : open();
    });
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);
    window._closeAccountPanel = close;

    wireForms();
    updateAccountDot();

    // If already logged in from a previous visit, start polling quietly
    // in the background so the unread dot can light up even before the
    // panel is opened.
    if (window.Auth.isLoggedIn()) startPolling();
}

function wireForms(){
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');
    const showLoginWrap = document.getElementById('showLoginWrap');
    const accountSwitch = loginForm.nextElementSibling; // "No account yet?" paragraph
    const errorEl = document.getElementById('accountError');

    showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.hidden = true;
        accountSwitch.hidden = true;
        registerForm.hidden = false;
        showLoginWrap.hidden = false;
        errorEl.hidden = true;
    });
    showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.hidden = true;
        showLoginWrap.hidden = true;
        loginForm.hidden = false;
        accountSwitch.hidden = false;
        errorEl.hidden = true;
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const username = document.getElementById('loginUsername').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;
        try {
            await window.Auth.login(username, password);
            loginForm.reset();
            refreshAccountView();
            startPolling();
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const username = document.getElementById('registerUsername').value.trim().toLowerCase();
        const password = document.getElementById('registerPassword').value;
        try {
            await window.Auth.register(username, password);
            // auto-login right after registering
            await window.Auth.login(username, password);
            registerForm.reset();
            refreshAccountView();
            startPolling();
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        window.Auth.logout();
        stopPolling();
        refreshAccountView();
    });

    document.getElementById('chatSendBtn').addEventListener('click', async () => {
        const toEl = document.getElementById('chatTo');
        const textEl = document.getElementById('chatText');
        const chatError = document.getElementById('chatError');
        chatError.hidden = true;

        const to = toEl.value.trim().toLowerCase();
        const text = textEl.value.trim();
        if (!to || !text) return;

        try {
            await window.Chat.send(to, text);
            appendChatLine({ from: window.Auth.getUsername(), text, ts: Date.now() }, true);
            textEl.value = '';
        } catch (err) {
            chatError.textContent = err.message;
            chatError.hidden = false;
        }
    });
}

function refreshAccountView(){
    const loggedOut = document.getElementById('loggedOutView');
    const loggedIn = document.getElementById('loggedInView');

    if (window.Auth.isLoggedIn()) {
        loggedOut.hidden = true;
        loggedIn.hidden = false;
        document.getElementById('whoami').textContent = window.Auth.getUsername();
        document.getElementById('chatLog').innerHTML = '';
        seenMessageKeys.clear();
        pollOnce(); // immediate refresh when opening
    } else {
        loggedOut.hidden = false;
        loggedIn.hidden = true;
    }
}

function appendChatLine(msg, isOutgoing){
    const key = `${msg.from}:${msg.ts}`;
    if (seenMessageKeys.has(key)) return;
    seenMessageKeys.add(key);

    const log = document.getElementById('chatLog');
    if (!log) return;

    const li = document.createElement('li');
    li.className = 'chat-line' + (isOutgoing ? ' chat-line--out' : '');
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = isOutgoing ? 'you' : msg.from;
    const body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = msg.text;
    li.appendChild(who);
    li.appendChild(body);
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
}

async function pollOnce(){
    if (!window.Auth.isLoggedIn()) return;
    try {
        const { messages, serverTime } = await window.Chat.poll(lastMessageTs);
        messages.forEach(m => appendChatLine(m, false));
        if (messages.length) {
            lastMessageTs = Math.max(...messages.map(m => m.ts));
            if (!document.getElementById('accountPanel').classList.contains('show')) {
                document.getElementById('accountDot').hidden = false;
            }
        }
    } catch (e) {
        // silent — polling errors shouldn't interrupt the rest of the site
    }
}

function startPolling(){
    stopPolling();
    pollOnce();
    chatPollTimer = setInterval(pollOnce, 8000); // 8s poll — gentle on the free tier
}
function stopPolling(){
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
}

function updateAccountDot(){
    const dot = document.getElementById('accountDot');
    const toggle = document.getElementById('accountToggle');
    if (!dot || !toggle) return;
    toggle.addEventListener('click', () => { dot.hidden = true; });
}

document.addEventListener('DOMContentLoaded', () => {
    initAccountPanel();
    window.sendVisitBeacon && window.sendVisitBeacon();
});
