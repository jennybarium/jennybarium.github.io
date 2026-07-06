/* ─────────────────────────────────────────────────────────────────
   account-page.js
   Standalone /account/ page version of the login/register/chat UI.
   Same logic as the old in-page account panel (account-ui.js), just
   without the open/close/scrim/dot machinery — this is a real page
   now, not a modal, and there's no game FAB or journal panel here.
   ───────────────────────────────────────────────────────────────── */

let chatPollTimer = null;
let lastMessageTs = 0;
const seenMessageKeys = new Set();
let knownUsers = new Set();

function initAccountPage(){
    wireForms();
    refreshAccountView();

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
        if (window.Auth.isLoggedIn()) { refreshAccountView(); return; }
        errorEl.hidden = true;
        const btn = loginForm.querySelector('button[type="submit"]');
        const username = document.getElementById('loginUsername').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;
        setBtnLoading(btn, true);
        try {
            await window.Auth.login(username, password);
            loginForm.reset();
            document.getElementById('loggedOutView').hidden = true;
            refreshAccountView();
            startPolling();
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
        } finally {
            setBtnLoading(btn, false);
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (window.Auth.isLoggedIn()) { refreshAccountView(); return; }
        errorEl.hidden = true;
        const btn = registerForm.querySelector('button[type="submit"]');
        const username = document.getElementById('registerUsername').value.trim().toLowerCase();
        const password = document.getElementById('registerPassword').value;
        setBtnLoading(btn, true);
        try {
            await window.Auth.register(username, password);
            await window.Auth.login(username, password);
            registerForm.reset();
            document.getElementById('loggedOutView').hidden = true;
            refreshAccountView();
            startPolling();
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
        } finally {
            setBtnLoading(btn, false);
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        window.Auth.logout();
        stopPolling();
        refreshAccountView();
    });

    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.addEventListener('click', async () => {
        const toEl = document.getElementById('chatTo');
        const textEl = document.getElementById('chatText');
        const chatError = document.getElementById('chatError');
        chatError.hidden = true;

        const to = toEl.value.trim().toLowerCase();
        const text = textEl.value.trim();
        if (!to || !text) return;

        setBtnLoading(sendBtn, true);
        try {
            await window.Chat.send(to, text);
            appendChatLine({ from: window.Auth.getUsername(), text, ts: Date.now() }, true);
            textEl.value = '';
        } catch (err) {
            chatError.textContent = err.message;
            chatError.hidden = false;
        } finally {
            setBtnLoading(sendBtn, false);
        }
    });

    wireRecipientCheck();
}

function wireRecipientCheck(){
    const toEl = document.getElementById('chatTo');
    const statusEl = document.getElementById('chatToStatus');
    if (!toEl || !statusEl) return;

    let debounceTimer = null;

    function evaluate(){
        const val = toEl.value.trim().toLowerCase();
        if (!val) {
            statusEl.classList.remove('is-visible');
            statusEl.textContent = '';
            statusEl.removeAttribute('data-state');
            return;
        }
        if (val === window.Auth.getUsername()) {
            statusEl.dataset.state = 'bad';
            statusEl.textContent = '❌';
            statusEl.title = "That's you";
            statusEl.classList.add('is-visible');
            return;
        }
        const exists = knownUsers.has(val);
        statusEl.dataset.state = exists ? 'ok' : 'bad';
        statusEl.textContent = exists ? '✅' : '❌';
        statusEl.title = exists ? 'User found' : 'No user with that id (among visible users)';
        statusEl.classList.add('is-visible');
    }

    toEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(evaluate, 120);
    });
    toEl.addEventListener('blur', evaluate);
}

function setBtnLoading(btn, loading){
    if (!btn) return;
    const label = btn.querySelector('.btn-label');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled = loading;
    if (spinner) spinner.hidden = !loading;
    if (label) label.style.opacity = loading ? '0.6' : '1';
}

function resetAccountSubView(){
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showLoginWrap = document.getElementById('showLoginWrap');
    const accountSwitch = loginForm ? loginForm.nextElementSibling : null;
    if (loginForm) loginForm.hidden = false;
    if (registerForm) registerForm.hidden = true;
    if (showLoginWrap) showLoginWrap.hidden = true;
    if (accountSwitch) accountSwitch.hidden = false;
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
        pollOnce();
        refreshKnownUsers();
        renderChatLogEmptyState();
    } else {
        loggedOut.hidden = false;
        loggedIn.hidden = true;
        resetAccountSubView();
    }
}

async function refreshKnownUsers(){
    if (!window.Auth.isLoggedIn()) return;
    try {
        const users = await window.Chat.listUsers();
        knownUsers = new Set(users);
        const datalist = document.getElementById('knownUsersList');
        if (datalist) {
            datalist.innerHTML = '';
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u;
                datalist.appendChild(opt);
            });
        }
    } catch (e) {
        // silent — the exists-check just degrades to "unknown" state
    }
}

function renderChatLogEmptyState(){
    const log = document.getElementById('chatLog');
    const tag = document.getElementById('chatLogEmpty');
    if (!log || !tag) return;
    const hasMessages = log.querySelector('.chat-line') !== null;
    tag.hidden = hasMessages;
}

function formatMsgTime(ts){
    try {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
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
    const meta = document.createElement('span');
    meta.className = 'chat-meta';
    meta.textContent = formatMsgTime(msg.ts);

    li.appendChild(who);
    li.appendChild(body);
    li.appendChild(meta);
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;

    renderChatLogEmptyState();
}

async function pollOnce(){
    if (!window.Auth.isLoggedIn()) return;
    try {
        const { messages } = await window.Chat.poll(lastMessageTs);
        messages.forEach(m => appendChatLine(m, false));
        if (messages.length) {
            lastMessageTs = Math.max(...messages.map(m => m.ts));
        }
    } catch (e) {
        // silent — polling errors shouldn't interrupt the rest of the page
    }
}

function startPolling(){
    stopPolling();
    pollOnce();
    chatPollTimer = setInterval(pollOnce, 30000);
}
function stopPolling(){
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = null;
}

/* Applies Worker-driven site config: if maintenanceMode is on,
   disables the forms rather than pretending the backend still works.
   Fails open (page behaves normally) if the config fetch itself fails. */
async function applySiteConfig(){
    if (!window.SiteConfig) return;
    const config = await window.SiteConfig.load();

    if (config.maintenanceMode) {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const errorEl = document.getElementById('accountError');
        [loginForm, registerForm].forEach(f => {
            if (!f) return;
            f.querySelectorAll('input, button').forEach(el => el.disabled = true);
        });
        if (errorEl) {
            errorEl.textContent = 'Accounts and messaging are temporarily offline for maintenance — please check back soon.';
            errorEl.hidden = false;
        }
        stopPolling();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAccountPage();
    applySiteConfig();
});