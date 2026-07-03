/* =========================================================
ATELIER — creative index
script.js — graph, nav, content panel, journal log, player
All content driven by topics.json / diary.json.
========================================================= */
const CATEGORY_COLORS = {
    creative: '#ff6f9c', // Coral bloom
    systems:  '#6fe3c4', // Kelp / arctic teal
    science:  '#ffd27a', // Geyser amber
    personal: '#ff8fb1', // Soft coral
    default:  '#9d8cff'  // Violet iris
};

const state = {
    topics: [],
    diary: [],
    media: {},
};

/* Shared reference to the live graph — the game reads/writes this */
const graphState = { svg: null, nodeSel: null, nodes: [] };

/* Constellation Draw — memory/drawing game state */
const TRAIL_COLORS = ['#9d8cff', '#ff8fb1', '#6fe3c4', '#ffd27a', '#ff6f9c']; // iris, coral, kelp, amber, bloom
const gameState = {
    active: false,
    sequence: [],
    playerIndex: 0,
    level: 1,
    score: 0,
    accepting: false,
    highScore: parseInt(localStorage.getItem('atelier_game_highscore') || '0', 10) || 0,
    responseTimer: null,
    audioCtx: null,
    dragging: false,
    dragFromId: null,
    trailSegments: [],   // { id, sel, createdAt, fading } — permanent-until-fade lines for current round
    liveLineSel: null,   // the line currently following the pointer while dragging
};
const MIN_GAME_NODES = 4;

/* ---------------------------------------------------------
Telegram Mini App bridge — entirely optional
Every call in here is guarded behind `tg &&`, so on a normal
browser tab (where window.Telegram never exists) this whole
block is a silent no-op and the site behaves exactly as before.
--------------------------------------------------------- */
function initTelegram(){
    const tg = window.Telegram && window.Telegram.WebApp;
    if(!tg) return null;

    try {
        tg.ready();
        tg.expand();                     // open at full height instead of the collapsed sheet
        if(typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
        if(typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#0b0f16');
        if(typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0b0f16');
    } catch(err){
        console.warn('Telegram WebApp init skipped:', err);
        return null;
    }
    return tg;
}

/* Wires the Telegram BackButton to whichever overlay is open, and
   falls back to hiding itself when nothing is. No-ops entirely
   when initTelegram() returned null (i.e. not inside Telegram). */
function wireTelegramBackButton(tg){
    if(!tg || !tg.BackButton) return;

    function anyOverlayOpen(){
        return document.getElementById('navPanel')?.classList.contains('open')
            || document.getElementById('contentPanel')?.classList.contains('show')
            || document.getElementById('gameModal')?.classList.contains('show')
            || document.getElementById('oraclePanel')?.classList.contains('show');
    }

    function syncBackButton(){
        try {
            if(anyOverlayOpen()) tg.BackButton.show();
            else tg.BackButton.hide();
        } catch(err){ /* ignore — cosmetic only */ }
    }

    tg.BackButton.onClick(() => {
        if(document.getElementById('navPanel')?.classList.contains('open') && window._closeMenu) window._closeMenu();
        else if(document.getElementById('gameModal')?.classList.contains('show')) closeGameModal();
        else if(document.getElementById('contentPanel')?.classList.contains('show') && window._closeContentPanel) window._closeContentPanel();
        else if(document.getElementById('oraclePanel')?.classList.contains('show') && window._closeOracle) window._closeOracle();
        syncBackButton();
    });

    // Re-check whenever the DOM changes state on the panels we care about
    const observer = new MutationObserver(syncBackButton);
    ['navPanel','contentPanel','gameModal','oraclePanel'].forEach(id => {
        const el = document.getElementById(id);
        if(el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    syncBackButton();
}

/* ---------------------------------------------------------
Boot
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    const tg = initTelegram();
    initAuroraScene();
    initMenu();
    initContentPanel();
    initGame();
    initOracle();
    initPlayer();
    loadData();
    wireTelegramBackButton(tg);
});

/* ---------------------------------------------------------
Aurora Borealis background scene
Generates flickering stars and drifting northern-lights bands
with randomized hues so the palette differs slightly per visit.
--------------------------------------------------------- */
function initAuroraScene(){
    const scene = document.getElementById('auroraScene');
    if (!scene) return;

    const randomInRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // fewer animated layers on small/low-power screens: same look at a
    // glance, meaningfully less paint & battery work on phones
    const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const STAR_COUNT = isSmallScreen ? 24 : 40;
    const LIGHT_COUNT = isSmallScreen ? 14 : 24;

    // three hues drawn from the site's iris/coral/kelp/amber family so the
    // aurora always harmonizes with the rest of the palette
    const HUE_POOL = [255, 330, 165, 40];
    const HUES = [
        HUE_POOL[randomInRange(0, HUE_POOL.length - 1)],
        HUE_POOL[randomInRange(0, HUE_POOL.length - 1)],
        HUE_POOL[randomInRange(0, HUE_POOL.length - 1)]
    ];
    const ALPHAS = [0.35 + Math.random() * 0.25, 0.3 + Math.random() * 0.25, 0.3 + Math.random() * 0.25];

    const frag = document.createDocumentFragment();

    for (let s = 0; s < STAR_COUNT; s++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.setProperty('--size', (Math.random() * 2 + 0.5).toFixed(2));
        star.style.setProperty('--x', (Math.random() * 100).toFixed(2));
        star.style.setProperty('--y', (Math.random() * 60).toFixed(2));
        star.style.setProperty('--duration', randomInRange(5, 10));
        star.style.setProperty('--delay', randomInRange(0, 8));
        frag.appendChild(star);
    }

    const beach = buildBioluminescentBeach(isSmallScreen);
    frag.appendChild(beach);

    const moon = document.createElement('div');
    moon.className = 'moon';
    frag.appendChild(moon);

    const lights = document.createElement('div');
    lights.className = 'lights';
    lights.style.setProperty('--hue-1', HUES[0]);
    lights.style.setProperty('--hue-2', HUES[1]);
    lights.style.setProperty('--hue-3', HUES[2]);
    lights.style.setProperty('--alpha-1', ALPHAS[0].toFixed(2));
    lights.style.setProperty('--alpha-2', ALPHAS[1].toFixed(2));
    lights.style.setProperty('--alpha-3', ALPHAS[2].toFixed(2));

    for (let l = 0; l < LIGHT_COUNT; l++) {
        const light = document.createElement('div');
        light.className = 'light';
        light.style.setProperty('--duration', randomInRange(8, 18));
        light.style.setProperty('--delay', randomInRange(0, 10));
        light.style.setProperty('--x', randomInRange(0, 5));
        light.style.setProperty('--y', randomInRange(0, 10));
        lights.appendChild(light);
    }
    frag.appendChild(lights);

    scene.appendChild(frag);

    initMeteors(scene);
}

/* ---------------------------------------------------------
Bioluminescent beach scene builder
Draws a natural, irregular wave-edge silhouette and a lacy foam
line as SVG paths (so they read as an actual curling shoreline,
not a straight gradient band), then scatters glowing "plankton"
flecks along the waterline that flicker on/off individually —
mimicking how real bioluminescent algae glow in bursts when the
surf agitates them, rather than as one static wash of color.
--------------------------------------------------------- */
function buildBioluminescentBeach(isSmallScreen){
    const randomInRange = (min, max) => Math.random() * (max - min) + min;

    const beach = document.createElement('div');
    beach.className = 'beach';

    const sand = document.createElement('div');
    sand.className = 'beach-sand';
    beach.appendChild(sand);

    // wave edge: an irregular horizontal wavy line, drawn once per
    // load with slight randomization so the coastline isn't identical
    // every visit, but always reads as a natural curling wave
    const waveWrap = document.createElement('div');
    waveWrap.className = 'beach-wave';
    const waveY = 26;
    let waveD = `M-10 ${waveY}`;
    const waveSegments = 7;
    for (let i = 0; i <= waveSegments; i++) {
        const x = -10 + (i * (120 / waveSegments));
        const y = waveY + Math.sin(i * 1.3) * 5 + randomInRange(-3, 3);
        waveD += ` Q${x - 6} ${y + randomInRange(-4, 4)} ${x} ${y}`;
    }
    waveWrap.innerHTML = `<svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <path d="${waveD}" fill="none" stroke="rgba(120,235,255,0.35)" stroke-width="0.8" vector-effect="non-scaling-stroke"/>
        <path d="${waveD} L110 40 L-10 40 Z" fill="rgba(8,14,16,0.9)"/>
    </svg>`;
    beach.appendChild(waveWrap);

    // glow band that sits along the wave edge
    const glow = document.createElement('div');
    glow.className = 'beach-glow';
    beach.appendChild(glow);

    // thin lacy foam line, a second irregular path above the wave
    const foamWrap = document.createElement('div');
    foamWrap.className = 'beach-foam';
    let foamD = `M-10 20`;
    for (let i = 0; i <= 9; i++) {
        const x = -10 + (i * 13);
        const y = 20 + Math.sin(i * 2.1) * 6 + randomInRange(-3, 3);
        foamD += ` T${x} ${y}`;
    }
    foamWrap.innerHTML = `<svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <path d="${foamD}" fill="none" stroke="rgba(235,250,248,0.5)" stroke-width="0.6" stroke-dasharray="0.2 1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
    beach.appendChild(foamWrap);

    // scattered glowing plankton, concentrated in a band around the
    // waterline (y 18–34%) with a few stragglers up on the wet sand
    const PLANKTON_COUNT = isSmallScreen ? 26 : 46;
    const HUE_CHOICES = [165, 175, 185, 155, 195]; // teal → cyan family
    const frag = document.createDocumentFragment();
    for (let p = 0; p < PLANKTON_COUNT; p++) {
        const fleck = document.createElement('div');
        fleck.className = 'plankton';
        const nearLine = Math.random() < 0.75;
        const py = nearLine ? randomInRange(16, 34) : randomInRange(34, 60);
        fleck.style.setProperty('--px', randomInRange(0, 100).toFixed(1));
        fleck.style.setProperty('--py', py.toFixed(1));
        fleck.style.setProperty('--psize', randomInRange(1.2, 3.2).toFixed(2));
        fleck.style.setProperty('--phue', HUE_CHOICES[Math.floor(Math.random() * HUE_CHOICES.length)]);
        fleck.style.setProperty('--pduration', randomInRange(2.4, 5.5).toFixed(2));
        fleck.style.setProperty('--pdelay', randomInRange(0, 6).toFixed(2));
        fleck.style.setProperty('--ppeak', randomInRange(0.55, 1).toFixed(2));
        frag.appendChild(fleck);
    }
    beach.appendChild(frag);

    return beach;
}


function initMeteors(scene){
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const isSmallScreen = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const HUE_CHOICES = [255, 330, 165, 40, 200, 20, 285];
    const randomInRange = (min, max) => Math.random() * (max - min) + min;

    function spawnMeteor(){
        const meteor = document.createElement('div');
        meteor.className = 'meteor';

        const hue = HUE_CHOICES[Math.floor(Math.random() * HUE_CHOICES.length)];
        const angle = randomInRange(15, 55) * (Math.random() < 0.5 ? 1 : -1); // random angle, either diagonal
        const duration = randomInRange(0.9, 2.1);
        const length = randomInRange(90, 200);
        const travel = randomInRange(140, 320);

        meteor.style.setProperty('--mhue', hue);
        meteor.style.setProperty('--mangle', angle.toFixed(1));
        meteor.style.setProperty('--mduration', duration.toFixed(2));
        meteor.style.setProperty('--mlen', length.toFixed(0));
        meteor.style.setProperty('--mtravel', travel.toFixed(0));
        meteor.style.setProperty('--mx', randomInRange(0, 85).toFixed(1));
        meteor.style.setProperty('--my', randomInRange(0, 55).toFixed(1));

        meteor.addEventListener('animationend', () => meteor.remove());
        scene.appendChild(meteor);
    }

    function scheduleNext(){
        // occasional, irregular timing so it feels natural rather than metronomic;
        // a bit more sparse on phones to keep animation work light
        const delay = isSmallScreen ? randomInRange(2600, 6800) : randomInRange(1800, 5200);
        setTimeout(() => {
            spawnMeteor();
            // small chance of a quick double-streak (skipped on mobile)
            if (!isSmallScreen && Math.random() < 0.18) setTimeout(spawnMeteor, randomInRange(150, 500));
            scheduleNext();
        }, delay);
    }

    spawnMeteor();
    scheduleNext();
}

async function loadJSON(path, fallback){
    try{
        const res = await fetch(path);
        if(!res.ok) throw new Error(`${path}: ${res.status}`);
        return await res.json();
    } catch(err){
        console.error(`Failed to load ${path}`, err);
        return fallback;
    }
}

/* ---------------------------------------------------------
Lazy-load third-party libraries only when actually needed,
instead of blocking initial page render for every visitor. */
let _d3LoadPromise = null;
function loadD3(){
    if (window.d3) return Promise.resolve(window.d3);
    if (_d3LoadPromise) return _d3LoadPromise;
    _d3LoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://d3js.org/d3.v7.min.js';
        script.onload = () => resolve(window.d3);
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return _d3LoadPromise;
}

async function loadData(){
    const [topics, media] = await Promise.all([
        loadJSON('topics.json', []),
        loadJSON('media.json', {})
    ]);
    state.topics = topics;
    state.media  = media;

    renderNav();
    await loadD3();
    renderGraph();
    refreshJournalForAuthState();

    // --- new ---
    handleRoute();
    window.addEventListener('hashchange', handleRoute);
}

/* ---------------------------------------------------------
Media registry helpers
Every media file gets one entry in media.json: "key": "path".
Topics reference media by key, never by raw path, so moving or
renaming a file only means editing media.json in one place.
--------------------------------------------------------- */

/** Resolve a media key to its real path. Returns '' (and warns) if missing. */
function M(key){
    const path = state.media[key];
    if(!path){
        console.warn(`media.json has no entry for key "${key}"`);
        return '';
    }
    return path;
}

/**
 * Build an HTML string for a media block, so topic content never needs
 * raw <img>/<audio>/<video> tags. Usage inside a topic's `content`
 * string (or content array — see renderTopicBody):
 *   mediaTag('image', 'labradorite-1', { alt: 'Labradorite specimen' })
 *
 * type: 'image' | 'audio' | 'video'
 * key:  a key from media.json
 * opts: { alt, caption, controls (default true), autoplay, loop, muted, width, height }
 */
function mediaTag(type, key, opts = {}){
    const src = M(key);
    if(!src) return '<p class="hint">Missing media: ' + escapeHtml(key) + '</p>';

    const caption = opts.caption
        ? `<figcaption>${escapeHtml(opts.caption)}</figcaption>` : '';

    if(type === 'image'){
        const alt = escapeHtml(opts.alt || opts.caption || key);
        return `<figure class="media-figure"><img src="${src}" alt="${alt}" loading="lazy">${caption}</figure>`;
    }
    if(type === 'audio'){
        const controls = opts.controls === false ? '' : 'controls';
        return `<figure class="media-figure"><audio src="${src}" ${controls} ${opts.loop ? 'loop' : ''} preload="metadata"></audio>${caption}</figure>`;
    }
    if(type === 'video'){
        const controls = opts.controls === false ? '' : 'controls';
        return `<figure class="media-figure"><video src="${src}" ${controls} ${opts.autoplay ? 'autoplay' : ''} ${opts.loop ? 'loop' : ''} ${opts.muted ? 'muted' : ''} playsinline></video>${caption}</figure>`;
    }
    return '';
}

/**
 * Renders a topic's `content` field. Supports two forms:
 *  - String: raw HTML (existing topics keep working unchanged).
 *  - Array of blocks: e.g.
 *      [
 *        { "type": "text",  "html": "<p>Some paragraph</p>" },
 *        { "type": "image", "key": "labradorite-1", "caption": "Found June 2026" },
 *        { "type": "audio", "key": "cover-track-1", "caption": "Rough take, take 3" },
 *        { "type": "video", "key": "site-demo-clip" }
 *      ]
 *    This is the easy path for adding media without writing HTML.
 */
function renderTopicBody(topic){
    const content = topic.content;

    if(typeof content === 'string' || !content){
        return content || '<p class="hint">No content yet.</p>';
    }

    if(Array.isArray(content)){
        return content.map(block => {
            if(block.type === 'text')  return block.html || '';
            if(block.type === 'image') return mediaTag('image', block.key, block);
            if(block.type === 'audio') return mediaTag('audio', block.key, block);
            if(block.type === 'video') return mediaTag('video', block.key, block);
            return '';
        }).join('');
    }

    return '<p class="hint">No content yet.</p>';
}

/* ---------------------------------------------------------
Hidden slide-out menu
--------------------------------------------------------- */
function initMenu(){
    const toggle = document.getElementById('menuToggle');
    const panel  = document.getElementById('navPanel');
    const scrim  = document.getElementById('navScrim');

    function open(){
        panel.classList.add('open');
        scrim.classList.add('show');
        toggle.setAttribute('aria-expanded','true');
        panel.setAttribute('aria-hidden','false');
    }
    function close(){
        panel.classList.remove('open');
        scrim.classList.remove('show');
        toggle.setAttribute('aria-expanded','false');
        panel.setAttribute('aria-hidden','true');
    }

    toggle.addEventListener('click', () => {
        panel.classList.contains('open') ? close() : open();
    });
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', e => {
        if(e.key === 'Escape') close();
    });
    window._closeMenu = close;
}

function renderNav(){
    const list = document.getElementById('navList');
    list.innerHTML = '';
    visibleTopics().forEach(topic => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = topic.name;
        btn.addEventListener('click', () => {
            window._closeMenu();
            openContentPanel(topic);
        });
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function visibleTopics(){
    return state.topics.filter(t => t.show === true);
}

/* ---------------------------------------------------------
Content panel (modal)
--------------------------------------------------------- */
function initContentPanel(){
    const panel = document.getElementById('contentPanel');
    const scrim = document.getElementById('contentScrim');
    const closeBtn = document.getElementById('closePanel');

    function close(){
        panel.classList.remove('show');
        scrim.classList.remove('show');
        panel.setAttribute('aria-hidden','true');
    }

    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', e => {
        if(e.key === 'Escape') close();
    });
    window._closeContentPanel = close;
}

function openContentPanel(topic){
    const panel = document.getElementById('contentPanel');
    const scrim = document.getElementById('contentScrim');
    const category = document.getElementById('contentCategory');
    const title = document.getElementById('contentTitle');
    const body = document.getElementById('contentBody');

    category.textContent = topic.category ? `// ${topic.category}` : '// uncategorized';
    category.style.color = CATEGORY_COLORS[topic.category] || CATEGORY_COLORS.default;
    title.textContent = topic.name;
    body.innerHTML = renderTopicBody(topic);

    // --- new: add a link to the full page ---
    const fullLink = document.createElement('a');
    fullLink.href = `#${topic.slug}`;
    fullLink.textContent = 'Open full page';
    fullLink.style.display = 'block';
    fullLink.style.marginTop = '20px';
    fullLink.style.color = 'var(--ochre)';
    fullLink.style.fontFamily = 'var(--body)';
    fullLink.style.fontSize = '14px';
    fullLink.style.letterSpacing = '0.05em';
    fullLink.style.textDecoration = 'none';
    fullLink.style.borderBottom = '1px dotted var(--ochre)';
    body.appendChild(fullLink);

    panel.classList.add('show');
    scrim.classList.add('show');
    panel.setAttribute('aria-hidden','false');
    panel.querySelector('.content-panel-inner').scrollTop = 0;
}

/* ---------------------------------------------------------
Journal log stream — PRIVATE. Diary entries live server-side in
CONTENT_KV (key "private:diary") and are only ever fetched over
the authenticated /api/private-content route, so a signed-out
visitor never receives the entries at all (not even hidden in
the DOM) — unlike topics/media, which are public by design.
--------------------------------------------------------- */
async function refreshJournalForAuthState(){
    const list = document.getElementById('journalList');
    const logEl = document.getElementById('journalLog');
    if (!list || !logEl) return;

    if (!window.Auth || !window.Auth.isLoggedIn()) {
        state.diary = [];
        renderJournalLocked();
        return;
    }

    renderJournalLoading();
    try {
        const raw = await window.fetchPrivateContent('diary');
        const entries = JSON.parse(raw);
        state.diary = Array.isArray(entries) ? entries : [];
        renderJournal();
    } catch (e) {
        // Not found / not authorized / malformed — fail closed, not with
        // a confusing empty list that looks like "no entries exist".
        state.diary = [];
        renderJournalLocked();
    }
}

function renderJournalLocked(){
    const list = document.getElementById('journalList');
    if (!list) return;
    list.innerHTML = `<li class="journal-locked">
        <div class="journal-locked-text">sign in to read the sketchbook</div>
    </li>`;
}

function renderJournalLoading(){
    const list = document.getElementById('journalList');
    if (!list) return;
    list.innerHTML = `<li class="journal-locked">
        <div class="journal-locked-text">loading…</div>
    </li>`;
}

function renderJournal(){
    const list = document.getElementById('journalList');
    list.innerHTML = '';

    if (!state.diary.length) {
        list.innerHTML = `<li class="journal-locked">
            <div class="journal-locked-text">no entries yet</div>
        </li>`;
        return;
    }

    const sorted = [...state.diary].sort((a,b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(entry => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="journal-date">${escapeHtml(entry.date)}</div> <div class="journal-title">${escapeHtml(entry.title)}</div> <div class="journal-text">${escapeHtml(entry.text)}</div>`;
        list.appendChild(li);
    });
}

function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

window.refreshJournalForAuthState = refreshJournalForAuthState;

/* ---------------------------------------------------------
Force-directed node graph (D3 v7)
--------------------------------------------------------- */
function renderGraph(){
    const section = document.getElementById('graphSection');
    const svgEl = document.getElementById('graph');
    const topics = visibleTopics();
    let width = section.clientWidth;
    let height = section.clientHeight;
    let pad = computePad(width, height);

    const svg = d3.select(svgEl)
        .attr('viewBox', [0, 0, width, height]);

    svg.selectAll('*').remove();

    const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

    // topic nodes float freely — no central hub, no connecting links
    const nodes = topics.map(t => ({ ...t, id: t.slug }));

    // layer for the game's colorful drawn trail (sits above links, below nodes)
    const gameLayer = zoomLayer.append('g').attr('class', 'game-trail-layer');

    const nodeSel = zoomLayer.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'node')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', d => `Open ${d.name}`)
        .call(drag(simulationRef));

    nodeSel.append('circle')
        .attr('r', 14)
        .attr('fill', 'rgba(18,26,38,0.82)')
        .attr('stroke', d => CATEGORY_COLORS[d.category] || CATEGORY_COLORS.default)
        .attr('stroke-width', 1.3)
        .style('color', d => CATEGORY_COLORS[d.category] || CATEGORY_COLORS.default); // drives currentColor glow in CSS

    nodeSel.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', 28)
        .text(d => d.name);

    nodeSel
        .on('click', (event, d) => {
            if(gameState.active) return; // clicks don't drive the game anymore — dragging does
            openContentPanel(d);
        })
        .on('keydown', (event, d) => {
            if(event.key === 'Enter' || event.key === ' '){
                event.preventDefault();
                if(gameState.active) return;
                openContentPanel(d);
            }
        })
        .on('mouseenter', function(){
            d3.select(this).select('circle').transition().duration(200).attr('r', 17);
        })
        .on('mouseleave', function(){
            d3.select(this).select('circle').transition().duration(200).attr('r', 14);
        });

    graphState.svg = svg;
    graphState.zoomLayer = zoomLayer;
    graphState.gameLayer = gameLayer;
    graphState.nodeSel = nodeSel;
    graphState.nodes = nodes;

    const strengths = axisStrengths(width, height);
    const simulation = d3.forceSimulation(nodes)
        .force('charge', d3.forceManyBody().strength(-280))
        .force('x', d3.forceX(width / 2).strength(strengths.x))
        .force('y', d3.forceY(height / 2).strength(strengths.y))
        .force('collision', d3.forceCollide().radius(36))
        .alphaDecay(0.02)
        .on('tick', ticked);

    simulationRef.current = simulation;

    function ticked(){
        // hard rectangular bounds so the graph fills the display instead of
        // drifting into a circular cluster
        nodes.forEach(d => {
            d.x = Math.max(pad.x, Math.min(width - pad.x, d.x));
            d.y = Math.max(pad.y, Math.min(height - pad.y, d.y));
        });

        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
        if(typeof updateGameTrailPositions === 'function') updateGameTrailPositions();
    }

    // gentle ambient drift so the graph feels alive even at rest
    let driftTimer = setInterval(() => {
        if(simulation.alpha() < 0.05){
            simulation.alpha(0.08).restart();
        }
    }, 3200);

    // subtle repulsion from mouse position
    svg.on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, zoomLayer.node());
        nodes.forEach(n => {
            if(n.fx != null) return;
            const dx = n.x - mx, dy = n.y - my;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if(dist < 120 && dist > 0.1){
                const force = (120 - dist) / 120 * 1.2;
                n.vx = (n.vx || 0) + (dx / dist) * force;
                n.vy = (n.vy || 0) + (dy / dist) * force;
            }
        });
        if(simulation.alpha() < 0.1) simulation.alpha(0.1).restart();
    });

    // zoom / pan
    svg.call(d3.zoom()
        .scaleExtent([0.5, 2.5])
        .on('zoom', (event) => {
            zoomLayer.attr('transform', event.transform);
        }));

    // resize handling
    window.addEventListener('resize', debounce(() => {
        width = section.clientWidth;
        height = section.clientHeight;
        pad = computePad(width, height);
        svg.attr('viewBox', [0, 0, width, height]);
        const s = axisStrengths(width, height);
        simulation.force('x', d3.forceX(width / 2).strength(s.x));
        simulation.force('y', d3.forceY(height / 2).strength(s.y));
        simulation.alpha(0.3).restart();
    }, 200));

    function drag(simRef){
        function dragstarted(event, d){
            if(!event.active) simRef.current.alphaTarget(0.2).restart();
            d.fx = d.x; d.fy = d.y;
        }
        function dragged(event, d){
            d.fx = event.x; d.fy = event.y;
        }
        function dragended(event, d){
            if(!event.active) simRef.current.alphaTarget(0);
            d.fx = null; d.fy = null;
        }
        return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
    }
}

const simulationRef = { current: null };

function debounce(fn, wait){
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

/* Pull strength per axis, tuned to the container's aspect ratio so the
   constellation spreads into a rectangle rather than settling into a
   circle. The shorter axis gets pulled in harder; the longer axis is
   left looser so nodes can spread out and fill the width (or height). */
function axisStrengths(w, h){
    const ratio = w / h;
    if(ratio >= 1){
        return { x: 0.045, y: Math.min(0.18, 0.05 * ratio) };
    }
    return { x: Math.min(0.18, 0.05 / ratio), y: 0.045 };
}

function computePad(w, h){
    return {
        x: Math.min(90, Math.max(40, w * 0.07)),
        y: Math.min(80, Math.max(40, h * 0.09)),
    };
}

/* ---------------------------------------------------------
Constellation Draw — a small memory/drawing game built from
the live topic nodes. The graph flashes a growing pattern;
the player redraws it by dragging a line from node to node
in the same order. Each segment drawn is rendered in its own
color, so a completed pattern leaves a small colorful
constellation behind before it fades. Every completed round
adds a star and quickens the pace, and the response window
shrinks as the level climbs — one wrong node under the
pointer, or a stalled response, ends the round.
--------------------------------------------------------- */
/* Keeps the game FAB visible only on the main graph view, and hides it
   whenever any popup/panel is open (content panel, account panel,
   game modal itself, oracle terminal, nav) — it's a graph-page feature,
   not a global one, and shouldn't float over unrelated screens. */
function updateGameFabVisibility(){
    const fab = document.getElementById('gameToggle');
    if (!fab) return;

    const onMainPage = !window.location.hash;
    const anyOverlayOpen = [
        'contentPanel', 'accountPanel', 'gameModal', 'oraclePanel', 'navPanel'
    ].some(id => {
        const el = document.getElementById(id);
        return el && (el.classList.contains('show') || el.classList.contains('open'));
    });

    fab.hidden = !onMainPage || anyOverlayOpen;
}

function initGame(){
    const fab = document.getElementById('gameToggle');
    const modal = document.getElementById('gameModal');
    const scrim = document.getElementById('gameScrim');
    const closeBtn = document.getElementById('closeGame');
    const startBtn = document.getElementById('startGameBtn');
    const retryBtn = document.getElementById('retryGameBtn');

    if(!fab || !modal) return;

    fab.addEventListener('click', openGameModal);
    closeBtn.addEventListener('click', closeGameModal);
    scrim.addEventListener('click', closeGameModal);
    startBtn.addEventListener('click', startGame);
    retryBtn.addEventListener('click', startGame);

    document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && modal.classList.contains('show')) closeGameModal();
    });

    const hs = document.getElementById('gameHighScore');
    if(hs) hs.textContent = gameState.highScore;

    initDrawing();

    // Track every overlay this site opens/closes so the fab's visibility
    // stays correct without having to thread calls through each handler.
    const watchedIds = ['contentPanel', 'accountPanel', 'gameModal', 'oraclePanel', 'navPanel'];
    watchedIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const observer = new MutationObserver(updateGameFabVisibility);
        observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    window.addEventListener('hashchange', updateGameFabVisibility);
    updateGameFabVisibility();
}

function openGameModal(){
    const modal = document.getElementById('gameModal');
    const scrim = document.getElementById('gameScrim');

    document.getElementById('gameStartScreen').hidden = false;
    document.getElementById('gameOverScreen').hidden = true;
    document.getElementById('gameHighScore').textContent = gameState.highScore;

    const warning = document.getElementById('gameWarning');
    const startBtn = document.getElementById('startGameBtn');
    if(graphState.nodes.length < MIN_GAME_NODES){
        warning.hidden = false;
        startBtn.disabled = true;
    } else {
        warning.hidden = true;
        startBtn.disabled = false;
    }

    modal.classList.add('show');
    scrim.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
}

function closeGameModal(){
    const modal = document.getElementById('gameModal');
    const scrim = document.getElementById('gameScrim');
    modal.classList.remove('show');
    scrim.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    endGame(false);
}

function ensureAudio(){
    if(!gameState.audioCtx){
        try {
            gameState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(err){ /* audio unavailable — game still works silently */ }
    }
    return gameState.audioCtx;
}

function playTone(freq, duration){
    const ctx = ensureAudio();
    if(!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000 + 0.03);
}

function nodeFreq(id){
    // stable tone per node id, spread across a pleasant piano-like range
    let hash = 0;
    for(let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return 220 + (hash % 12) * 55;
}

function flashNode(id, className, duration){
    if(!graphState.nodeSel) return;
    const sel = graphState.nodeSel.filter(d => d.id === id);
    sel.classed(className, true);
    setTimeout(() => sel.classed(className, false), duration);
}

function clearNodeStates(){
    if(graphState.nodeSel){
        graphState.nodeSel
            .classed('game-flash', false)
            .classed('game-correct', false)
            .classed('game-wrong', false);
    }
}

function nodeById(id){
    return graphState.nodes.find(n => n.id === id);
}

/* ---- colored trail: the line drawing left behind by the player ---- */
function trailColorForIndex(i){
    return TRAIL_COLORS[i % TRAIL_COLORS.length];
}

function addTrailSegment(fromId, toId, colorIndex){
    if(!graphState.gameLayer) return;
    const from = nodeById(fromId);
    const to = nodeById(toId);
    if(!from || !to) return;

    const color = trailColorForIndex(colorIndex);
    const sel = graphState.gameLayer.append('line')
        .attr('class', 'game-trail-segment')
        .attr('x1', from.x).attr('y1', from.y)
        .attr('x2', to.x).attr('y2', to.y)
        .attr('stroke', color)
        .style('filter', `drop-shadow(0 0 6px ${color})`)
        .style('opacity', 0);

    sel.transition().duration(120).style('opacity', 0.9);

    const record = { fromId, toId, sel, createdAt: Date.now() };
    gameState.trailSegments.push(record);
    return record;
}

function updateGameTrailPositions(){
    if(!gameState.trailSegments.length && !gameState.liveLineSel) return;
    gameState.trailSegments.forEach(seg => {
        const from = nodeById(seg.fromId);
        const to = nodeById(seg.toId);
        if(!from || !to || !seg.sel) return;
        seg.sel.attr('x1', from.x).attr('y1', from.y).attr('x2', to.x).attr('y2', to.y);
    });
    if(gameState.liveLineSel && gameState.dragFromId){
        const from = nodeById(gameState.dragFromId);
        if(from) gameState.liveLineSel.attr('x1', from.x).attr('y1', from.y);
    }
}

/* fades trail lines out slowly, one by one, oldest first */
function fadeTrailSlowly(){
    const segments = gameState.trailSegments.slice();
    gameState.trailSegments = [];
    segments.forEach((seg, i) => {
        if(!seg.sel) return;
        setTimeout(() => {
            seg.sel.transition().duration(1800).style('opacity', 0).remove();
        }, i * 260);
    });
}

/* instantly wipes the trail — used when the game ends */
function clearTrailImmediately(){
    gameState.trailSegments.forEach(seg => { if(seg.sel) seg.sel.interrupt().remove(); });
    gameState.trailSegments = [];
    if(gameState.liveLineSel){ gameState.liveLineSel.remove(); gameState.liveLineSel = null; }
}

function startLiveLine(fromId){
    if(!graphState.gameLayer) return;
    const from = nodeById(fromId);
    if(!from) return;
    const color = trailColorForIndex(gameState.playerIndex);
    gameState.liveLineSel = graphState.gameLayer.append('line')
        .attr('class', 'game-trail-live')
        .attr('x1', from.x).attr('y1', from.y)
        .attr('x2', from.x).attr('y2', from.y)
        .attr('stroke', color)
        .style('filter', `drop-shadow(0 0 6px ${color})`)
        .style('opacity', 0.85);
}

function updateLiveLineTo(x, y){
    if(gameState.liveLineSel) gameState.liveLineSel.attr('x2', x).attr('y2', y);
}

function endLiveLine(){
    if(gameState.liveLineSel){ gameState.liveLineSel.remove(); gameState.liveLineSel = null; }
}

/* ---- pointer-drag drawing interaction on the graph svg ---- */
function initDrawing(){
    const svgEl = document.getElementById('graph');
    if(!svgEl || svgEl._drawInit) return;
    svgEl._drawInit = true;

    function svgPoint(event){
        const pt = svgEl.createSVGPoint();
        const touch = event.touches ? event.touches[0] : event;
        pt.x = touch.clientX; pt.y = touch.clientY;
        const zoomNode = graphState.zoomLayer ? graphState.zoomLayer.node() : svgEl;
        const ctm = zoomNode.getScreenCTM();
        if(!ctm) return { x: 0, y: 0 };
        const local = pt.matrixTransform(ctm.inverse());
        return { x: local.x, y: local.y };
    }

    function nodeUnderPoint(x, y){
        let found = null;
        graphState.nodes.forEach(n => {
            const dx = n.x - x, dy = n.y - y;
            if(Math.sqrt(dx*dx + dy*dy) <= 22) found = n;
        });
        return found;
    }

    function onDown(event){
        if(!gameState.active || !gameState.accepting) return;
        const p = svgPoint(event);
        const n = nodeUnderPoint(p.x, p.y);
        if(!n) return;
        const expected = gameState.sequence[gameState.playerIndex];
        if(n.id !== expected){
            wrongNode(n.id);
            return;
        }
        event.preventDefault();
        gameState.dragging = true;
        gameState.dragFromId = n.id;
        registerCorrectNode(n.id);
        startLiveLine(n.id);
    }

    function onMove(event){
        if(!gameState.dragging) return;
        const p = svgPoint(event);
        updateLiveLineTo(p.x, p.y);
        const n = nodeUnderPoint(p.x, p.y);
        if(n && n.id !== gameState.dragFromId){
            const expected = gameState.sequence[gameState.playerIndex];
            if(n.id === expected){
                event.preventDefault();
                addTrailSegment(gameState.dragFromId, n.id, gameState.playerIndex - 1);
                endLiveLine();
                gameState.dragFromId = n.id;
                registerCorrectNode(n.id);
                if(gameState.dragging) startLiveLine(n.id);
            } else if(n.id !== expected) {
                wrongNode(n.id);
            }
        }
    }

    function onUp(){
        if(!gameState.dragging) return;
        gameState.dragging = false;
        gameState.dragFromId = null;
        endLiveLine();
    }

    svgEl.addEventListener('pointerdown', onDown);
    svgEl.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    svgEl.addEventListener('pointerleave', () => { if(gameState.dragging) updateHud('Your turn — draw the pattern'); });
}

function startGame(){
    if(graphState.nodes.length < MIN_GAME_NODES) return;
    ensureAudio();

    gameState.active = true;
    gameState.sequence = [];
    gameState.playerIndex = 0;
    gameState.level = 1;
    gameState.score = 0;
    gameState.accepting = false;
    gameState.dragging = false;
    gameState.dragFromId = null;
    clearTimeout(gameState.responseTimer);
    clearTrailImmediately();

    const modal = document.getElementById('gameModal');
    modal.classList.remove('show');
    document.getElementById('gameScrim').classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');

    document.getElementById('gameHud').hidden = false;
    updateHud('Watch closely…');

    nextRound();
}

function updateHud(status){
    document.getElementById('gameLevel').textContent = gameState.level;
    document.getElementById('gameScore').textContent = gameState.score;
    if(status !== undefined) document.getElementById('gameStatus').textContent = status;
}

function pickNextNode(){
    const pool = graphState.nodes;
    const last = gameState.sequence[gameState.sequence.length - 1];
    let choice;
    do {
        choice = pool[Math.floor(Math.random() * pool.length)];
    } while(pool.length > 1 && choice.id === last);
    return choice.id;
}
/* ---------------------------------------------------------
Full‑page topic view — standalone page within the same SPA
--------------------------------------------------------- */
function renderFullTopicPage(topic) {
    const categoryColor = CATEGORY_COLORS[topic.category] || CATEGORY_COLORS.default;
    return `
        <div style="margin-bottom: 32px;">
            <a href="#" onclick="history.back(); return false;" class="back-to-main-link">← Back to the main page</a>
        </div>
        <div class="content-eyebrow" style="color: ${categoryColor};">// ${topic.category || 'uncategorized'}</div>
        <h1 style="font-family: var(--disp); font-size: clamp(2rem, 5vw, 3.2rem); margin: 0 0 24px; border-bottom: 1px solid var(--line); padding-bottom: 20px; color: var(--ink-0);">${topic.name}</h1>
        <div class="content-body">${renderTopicBody(topic)}</div>
    `;
}

function showFullTopic(slug) {
    const topic = state.topics.find(t => t.slug === slug && t.show !== false);
    if (!topic) {
        // Invalid hash – go back to graph
        window.location.hash = '';
        return;
    }

    // Hide graph & journal, show full container
    document.getElementById('graphSection').style.display = 'none';
    document.getElementById('journalLog').style.display = 'none';
    const container = document.getElementById('fullTopicContainer');
    container.style.display = 'block';
    container.innerHTML = renderFullTopicPage(topic);

    // Update page title
    document.title = `:: ${topic.name} — Bariumana`;
    // Close any open popup/menu
    if (document.getElementById('contentPanel').classList.contains('show')) {
        window._closeContentPanel && window._closeContentPanel();
    }
    if (document.getElementById('navPanel').classList.contains('open')) {
        window._closeMenu && window._closeMenu();
    }
}

function showGraphView() {
    document.getElementById('graphSection').style.display = 'block';
    document.getElementById('journalLog').style.display = '';
    document.getElementById('fullTopicContainer').style.display = 'none';
    document.title = ':: Jenny Barium\'s personal website. from Bariumana!';
    // Optionally re-render graph if needed? Already rendered.
}

function handleRoute() {
    const hash = window.location.hash.slice(1); // remove '#'
    if (hash) {
        showFullTopic(hash);
    } else {
        showGraphView();
    }
    updateGameFabVisibility();
}
function nextRound(){
    // clear the previous round's drawing before showing the new pattern
    fadeTrailSlowly();
    gameState.sequence.push(pickNextNode());
    gameState.playerIndex = 0;
    gameState.accepting = false;
    updateHud('Watch closely…');
    setTimeout(playSequence, 500);
}

function playSequence(){
    if(!gameState.active) return;
    const seq = gameState.sequence;
    const flashDur = Math.max(260, 620 - gameState.level * 14);
    const gap = Math.max(140, 320 - gameState.level * 10);

    seq.forEach((id, i) => {
        setTimeout(() => {
            if(!gameState.active) return;
            flashNode(id, 'game-flash', flashDur);
            playTone(nodeFreq(id), flashDur);
        }, i * (flashDur + gap));
    });

    const totalTime = seq.length * (flashDur + gap);
    setTimeout(() => {
        if(!gameState.active) return;
        gameState.accepting = true;
        updateHud('Your turn — draw the pattern');
        armResponseTimer();
    }, totalTime + 150);
}

function armResponseTimer(){
    clearTimeout(gameState.responseTimer);
    const responseWindow = Math.max(900, 2400 - gameState.level * 35);
    gameState.responseTimer = setTimeout(() => {
        if(gameState.active && gameState.accepting) timeoutFail();
    }, responseWindow);
}

function timeoutFail(){
    const expected = gameState.sequence[gameState.playerIndex];
    flashNode(expected, 'game-wrong', 500);
    endGame(true);
}

/* called when the player correctly lands on (or starts from) the next
   expected node in the sequence — mid-drag */
function registerCorrectNode(id){
    flashNode(id, 'game-correct', 320);
    playTone(nodeFreq(id), 200);
    gameState.score += gameState.level * 10;
    gameState.playerIndex += 1;
    updateHud();

    if(gameState.playerIndex >= gameState.sequence.length){
        gameState.accepting = false;
        gameState.dragging = false;
        clearTimeout(gameState.responseTimer);
        endLiveLine();
        gameState.score += 50;
        gameState.level += 1;
        updateHud('Pattern complete!');
        setTimeout(nextRound, 900);
    } else {
        armResponseTimer();
    }
}

function wrongNode(id){
    gameState.accepting = false;
    gameState.dragging = false;
    gameState.dragFromId = null;
    clearTimeout(gameState.responseTimer);
    endLiveLine();
    const expected = gameState.sequence[gameState.playerIndex];
    flashNode(expected, 'game-flash', 500);
    flashNode(id, 'game-wrong', 500);
    playTone(110, 350);
    endGame(true);
}

function endGame(showSummary){
    const wasActive = gameState.active;
    gameState.active = false;
    gameState.accepting = false;
    gameState.dragging = false;
    gameState.dragFromId = null;
    clearTimeout(gameState.responseTimer);
    document.getElementById('gameHud').hidden = true;
    clearNodeStates();
    clearTrailImmediately(); // wipe the drawing when the game ends

    if(!wasActive) return;

    const isNewBest = gameState.score > gameState.highScore;
    if(isNewBest){
        gameState.highScore = gameState.score;
        localStorage.setItem('atelier_game_highscore', String(gameState.highScore));
    }

    if(showSummary){
        document.getElementById('finalLevel').textContent = gameState.level;
        document.getElementById('finalScore').textContent = gameState.score;
        document.getElementById('gameNewBest').hidden = !isNewBest;
        document.getElementById('gameStartScreen').hidden = true;
        document.getElementById('gameOverScreen').hidden = false;

        const modal = document.getElementById('gameModal');
        const scrim = document.getElementById('gameScrim');
        modal.classList.add('show');
        scrim.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
    }
}

/* ---------------------------------------------------------
The Oracle — a hidden terminal reached from the corner prompt.
No score, no fail state — just a small cryptic conversation
with the site itself, for anyone curious enough to click it.
Customize FILES / EVASIONS / the hidden-file payload below to
make it sound like you.
--------------------------------------------------------- */
function initOracle(){
    const trigger = document.getElementById('oracleToggle');
    const panel = document.getElementById('oraclePanel');
    const closeBtn = document.getElementById('oracleClose');
    const output = document.getElementById('oracleOutput');
    const input = document.getElementById('oracleInput');

    if(!trigger || !panel) return;

    let hasOpenedBefore = false;

    const FILES = {
        'notes.txt': "half of what's written here was true at 3am. the other half was true before that.",
        'origin.log': "this started as a sketchbook. it became a place to keep things I'm not ready to say out loud.",
    };
    const HIDDEN_NAME = '.hidden';
    const HIDDEN_ART =
`      .  *  .    .
   *    \\ | /   *
 .   *  --*--  .   .
   *    / | \\    *
      .  *  .`;
    const HIDDEN_LINE = "you weren't supposed to find this. good — that was always the point.";

    const EVASIONS = [
        "the archive declines to answer that.",
        "some doors don't open just because you knocked.",
        "not yet. maybe not ever.",
        "that question answers itself, if you sit with it a while.",
        "the oracle heard you. it just isn't in the mood.",
    ];

    function openOracle(){
        panel.classList.add('show');
        panel.setAttribute('aria-hidden', 'false');
        trigger.setAttribute('aria-expanded', 'true');
        if(!hasOpenedBefore){
            hasOpenedBefore = true;
            printLine('connection established — the archive is listening.', 'oracle-sys');
            printLine("type `help` if you must. or don't. try `ls`.", 'oracle-sys');
        }
        setTimeout(() => input.focus(), 60);
        scrollBottom();
    }

    function closeOracle(){
        panel.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
        trigger.setAttribute('aria-expanded', 'false');
    }
    window._closeOracle = closeOracle;

    trigger.addEventListener('click', () => {
        panel.classList.contains('show') ? closeOracle() : openOracle();
    });
    closeBtn.addEventListener('click', closeOracle);
    document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && panel.classList.contains('show')) closeOracle();
    });
    output.addEventListener('click', () => input.focus());

    function printLine(text, cls){
        const line = document.createElement('div');
        line.className = 'oracle-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        output.appendChild(line);
    }

    function printPre(text, cls){
        const pre = document.createElement('pre');
        pre.className = 'oracle-pre' + (cls ? ' ' + cls : '');
        pre.textContent = text;
        output.appendChild(pre);
    }

    function scrollBottom(){
        output.scrollTop = output.scrollHeight;
    }

    function handleCommand(raw){
        const cmd = raw.trim();
        if(!cmd) return;
        printLine('curator@atelier:~$ ' + cmd, 'oracle-echo');

        const [base, ...rest] = cmd.split(/\s+/);
        const arg = rest.filter(r => r !== '-a').join(' ');

        switch(base.toLowerCase()){
            case 'help':
                printLine('the ones who need it rarely ask. still — try: ls, cat <file>, whoami, clear, exit.', 'oracle-sys');
                break;
            case 'whoami':
                printLine('someone who builds rooms out of half-finished thoughts and calls it a portfolio.', 'oracle-sys');
                break;
            case 'ls':
                if(rest.includes('-a')){
                    printLine(Object.keys(FILES).join('  ') + '  ' + HIDDEN_NAME, 'oracle-sys');
                } else {
                    printLine(Object.keys(FILES).join('  ') + '  (2 more concealed — try `ls -a`)', 'oracle-sys');
                }
                break;
            case 'cat': {
                if(!arg){ printLine('cat: read what, exactly?', 'oracle-sys'); break; }
                const name = arg.replace(/^\.\/?/, '');
                if(name === HIDDEN_NAME){
                    printPre(HIDDEN_ART, 'oracle-art');
                    printLine(HIDDEN_LINE, 'oracle-secret');
                } else if(FILES[name]){
                    printLine(FILES[name], 'oracle-sys');
                } else {
                    printLine(`cat: ${arg}: no such fragment exists. yet.`, 'oracle-sys');
                }
                break;
            }
            case 'sudo':
                printLine('nice try. the archive answers to no one.', 'oracle-sys');
                break;
            case 'date':
                printLine('time moves differently in here. ask again outside.', 'oracle-sys');
                break;
            case 'clear':
                output.innerHTML = '';
                return;
            case 'exit':
            case 'close':
                closeOracle();
                return;
            default:
                printLine(EVASIONS[Math.floor(Math.random() * EVASIONS.length)], 'oracle-sys');
        }
        scrollBottom();
    }

    input.addEventListener('keydown', e => {
        if(e.key === 'Enter'){
            const val = input.value;
            input.value = '';
            handleCommand(val);
        }
    });
}

/* ---------------------------------------------------------
Minimal audio player
--------------------------------------------------------- */
async function initPlayer() {
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('playBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const modeToggle = document.getElementById('modeToggle');
  const progressBar = document.getElementById('progressBar');
  const progress = document.getElementById('trackProgress');
  const buffered = document.getElementById('trackBuffered');
  const timeCurrent = document.getElementById('timeCurrent');
  const timeDuration = document.getElementById('timeDuration');
  const volume = document.getElementById('volume');
  const title = document.getElementById('trackTitle');
  const sourcePickerBtn = document.getElementById('sourcePickerBtn');
  const sourcePickerPopup = document.getElementById('sourcePickerPopup');
  const sourcePickerScrim = document.getElementById('sourcePickerScrim');
  // .player has `transform: translateX(-50%)` for centering, which creates
  // a new containing block for any position:fixed descendant — that was
  // trapping the popup/scrim relative to .player instead of the viewport,
  // pushing the sheet off the top of the screen on compact layouts.
  // Move them out to <body> so position:fixed resolves against the
  // viewport as intended.
  if (sourcePickerPopup && sourcePickerPopup.parentElement !== document.body) {
    document.body.appendChild(sourcePickerPopup);
  }
  if (sourcePickerScrim && sourcePickerScrim.parentElement !== document.body) {
    document.body.appendChild(sourcePickerScrim);
  }
  const playerEl = document.getElementById('player');

  audio.volume = parseFloat(volume.value);
  let library = { music: [], radio: [] };
  let mode = 'music';
  let index = 0;
  let shuffle = false;

  try {
    const res = await fetch('assets/audio/playlist.json');
    const data = await res.json();
    library.music = data.tracks || [];
    library.radio = data.radio || [];
  } catch (err) {
    console.error('Failed to load playlist.json', err);
  }

  function currentList() { return library[mode]; }

  /* Filenames like "AURORA_You_Cant_Run_From_Yourself.mp3" have no
     natural wrap points, which forces the browser into a one-letter-
     per-line column when the player is narrow. Strip the extension and
     swap separators for spaces so the title reads cleanly and wraps
     normally like any other sentence. */
  function formatTitle(raw) {
    if (!raw) return 'Unknown Track';
    return raw
      .replace(/\.(mp3|wav|ogg|m4a|flac|aac)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
  }

  function formatTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  function renderSourcePickerPopup() {
    if (!sourcePickerPopup) return;
    sourcePickerPopup.innerHTML = '';
    currentList().forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'source-picker-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
      btn.textContent = formatTitle(item.title);
      btn.addEventListener('click', () => {
        loadTrack(i, true);
        closeSourcePicker();
      });
      sourcePickerPopup.appendChild(btn);
    });
  }

  function openSourcePicker() {
    if (!sourcePickerPopup || !currentList().length) return;
    renderSourcePickerPopup();
    sourcePickerPopup.hidden = false;
    sourcePickerScrim.hidden = false;
    sourcePickerBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSourcePicker() {
    if (!sourcePickerPopup) return;
    sourcePickerPopup.hidden = true;
    sourcePickerScrim.hidden = true;
    sourcePickerBtn.setAttribute('aria-expanded', 'false');
  }

  function setMode(newMode, autoplay) {
    mode = newMode;
    if (playerEl) playerEl.classList.toggle('is-radio-mode', mode === 'radio');
    modeToggle.classList.toggle('is-radio', mode === 'radio');
    modeToggle.setAttribute('aria-checked', mode === 'radio' ? 'true' : 'false');
    modeToggle.setAttribute('aria-label', mode === 'radio' ? 'Switch to music' : 'Switch to radio');

    [prevBtn, nextBtn, shuffleBtn].forEach(b => b.disabled = mode === 'radio');
    closeSourcePicker();
    renderSourcePickerPopup();
    audio.pause();
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');

    if (currentList().length) loadTrack(0, autoplay);
    else title.textContent = mode === 'radio' ? 'no stations' : 'no tracks';
  }

  function loadTrack(i, autoplay) {
    const list = currentList();
    if (!list.length) return;

    index = (i + list.length) % list.length;
    const item = list[index];

    audio.src = item.src;
    title.textContent = formatTitle(item.title);

    progress.style.width = '0%';
    buffered.style.width = '0%';
    title.classList.remove('is-buffering');

    timeCurrent.textContent = '0:00';
    timeDuration.textContent = mode === 'radio' ? 'LIVE' : '0:00';
    progressBar.style.cursor = mode === 'radio' ? 'default' : 'pointer';
    renderSourcePickerPopup();

    if (autoplay) {
      audio.play().then(() => {
        playBtn.textContent = '❚❚';
        playBtn.setAttribute('aria-label', 'Pause');
      }).catch((err) => {
        if (err && err.name === 'AbortError') return; // interrupted by a subsequent load/play, not a real error
        console.error('Playback error:', err);
        title.textContent = 'playback error';
        playBtn.textContent = '▶';
        playBtn.setAttribute('aria-label', 'Play');
      });
    }
  }

  function pickNextIndex(list) {
    if (list.length <= 1) return 0;
    if (!shuffle) return (index + 1) % list.length;
    let i;
    do { i = Math.floor(Math.random() * list.length); } while (i === index);
    return i;
  }

  function next() {
    const list = currentList();
    if (!list.length) return;
    loadTrack(pickNextIndex(list), !audio.paused);
  }

  function prev() {
    loadTrack(index - 1, !audio.paused);
  }

  setMode('music', false);

  modeToggle.addEventListener('click', () => {
    setMode(mode === 'music' ? 'radio' : 'music', true);
  });

  playBtn.addEventListener('click', () => {
    if (!currentList().length) return;
    if (audio.paused) {
      audio.play().then(() => {
        playBtn.textContent = '❚❚';
        playBtn.setAttribute('aria-label', 'Pause');
      }).catch((err) => {
        if (err && err.name === 'AbortError') return;
        console.error('Playback error:', err);
        title.textContent = 'playback error';
        playBtn.textContent = '▶';
        playBtn.setAttribute('aria-label', 'Play');
      });
    } else {
      audio.pause();
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-label', 'Play');
    }
  });

  nextBtn.addEventListener('click', next);
  prevBtn.addEventListener('click', prev);

  shuffleBtn.addEventListener('click', () => {
    shuffle = !shuffle;
    shuffleBtn.classList.toggle('is-active', shuffle);
  });

  if (sourcePickerBtn) {
    sourcePickerBtn.addEventListener('click', () => {
      if (sourcePickerPopup.hidden) openSourcePicker();
      else closeSourcePicker();
    });
  }
  if (sourcePickerScrim) {
    sourcePickerScrim.addEventListener('click', closeSourcePicker);
  }

  audio.addEventListener('timeupdate', () => {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      const percent = (audio.currentTime / audio.duration) * 100;
      progress.style.width = percent + '%';
      timeCurrent.textContent = formatTime(audio.currentTime);
      timeDuration.textContent = formatTime(audio.duration);
    }
  });

  audio.addEventListener('progress', () => {
    if (audio.duration && isFinite(audio.duration) && audio.buffered.length > 0) {
      const end = audio.buffered.end(audio.buffered.length - 1);
      const percent = (end / audio.duration) * 100;
      buffered.style.width = percent + '%';
    }
  });

  audio.addEventListener('waiting', () => {
    title.classList.add('is-buffering');
  });

  audio.addEventListener('playing', () => {
    title.classList.remove('is-buffering');
  });

  audio.addEventListener('canplay', () => {
    title.classList.remove('is-buffering');
  });

  let retried = false;
  audio.addEventListener('error', () => {
    if (retried) {
      title.textContent = mode === 'radio' ? 'stream unavailable' : "couldn't load track";
      return;
    }
    retried = true;
    title.classList.add('is-buffering');
    setTimeout(() => {
      audio.load();
      if (!audio.paused || mode === 'radio') audio.play().catch(() => {});
    }, 1500);
  });

  audio.addEventListener('loadstart', () => { retried = false; });

  progressBar.addEventListener('click', (e) => {
    if (mode === 'radio' || !audio.duration || !isFinite(audio.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  audio.addEventListener('ended', next);

  volume.addEventListener('input', () => {
    audio.volume = parseFloat(volume.value);
  });
}