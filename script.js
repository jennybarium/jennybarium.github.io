/* =========================================================
ATELIER — creative index
script.js — graph, nav, content panel, journal log, player
All content driven by topics.json / diary.json.
========================================================= */
const CATEGORY_COLORS = {
    creative: '#e07a5f', // Terracotta
    systems:  '#81b29a', // Sage
    science:  '#f2cc8f', // Pale Gold
    personal: '#b56576', // Muted Rose
    default:  '#d4a373'  // Ochre
};

const state = {
    topics: [],
    diary: [],
};

/* Shared reference to the live graph — the game reads/writes this */
const graphState = { svg: null, nodeSel: null, nodes: [] };

/* Constellation Recall — memory game state */
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
};
const MIN_GAME_NODES = 4;

/* ---------------------------------------------------------
Boot
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    initMenu();
    initContentPanel();
    initGame();
    initOracle();
    initPlayer();
    loadData();
});

async function loadData(){
    try{
        const [topicsRes, diaryRes] = await Promise.all([
            fetch('topics.json'),
            fetch('diary.json')
        ]);
        state.topics = await topicsRes.json();
        state.diary  = await diaryRes.json();
    } catch(err){
        console.error('Failed to load data', err);
        state.topics = [];
        state.diary = [];
    }
    renderNav();
    renderJournal();
    renderGraph();
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
    body.innerHTML = topic.content || '<p class="hint">No content yet.</p>';

    panel.classList.add('show');
    scrim.classList.add('show');
    panel.setAttribute('aria-hidden','false');
    panel.querySelector('.content-panel-inner').scrollTop = 0;
}

/* ---------------------------------------------------------
Journal log stream (diary.json)
--------------------------------------------------------- */
function renderJournal(){
    const list = document.getElementById('journalList');
    list.innerHTML = '';
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

    // central hub node representing "you" — everything routes through it
    const hub = { id: 'hub', name: 'ATELIER', hub: true };
    const nodes = [hub, ...topics.map(t => ({ ...t, id: t.slug }))];
    const links = topics.map(t => ({ source: 'hub', target: t.slug }));

    const linkSel = zoomLayer.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('class', 'link');

    const nodeSel = zoomLayer.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'node')
        .attr('tabindex', d => d.hub ? -1 : 0)
        .attr('role', d => d.hub ? null : 'button')
        .attr('aria-label', d => d.hub ? null : `Open ${d.name}`)
        .call(drag(simulationRef));

    nodeSel.append('circle')
        .attr('r', d => d.hub ? 26 : 14)
        .attr('fill', d => d.hub ? 'rgba(212,163,115,0.05)' : 'rgba(46,42,38,0.85)')
        .attr('stroke', d => d.hub ? '#d4a373' : (CATEGORY_COLORS[d.category] || CATEGORY_COLORS.default))
        .attr('stroke-width', d => d.hub ? 1.5 : 1.2)
        .style('filter', 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))'); // Soft shadow instead of neon glow

    nodeSel.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.hub ? 42 : 28)
        .text(d => d.hub ? '' : d.name);

    nodeSel.filter(d => !d.hub)
        .on('click', (event, d) => {
            if(gameState.active){ handleGameNodeClick(d); return; }
            openContentPanel(d);
        })
        .on('keydown', (event, d) => {
            if(event.key === 'Enter' || event.key === ' '){
                event.preventDefault();
                if(gameState.active){ handleGameNodeClick(d); return; }
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
    graphState.nodeSel = nodeSel;
    graphState.nodes = nodes.filter(n => !n.hub);

    const strengths = axisStrengths(width, height);
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(d => 140).strength(0.45))
        .force('charge', d3.forceManyBody().strength(-280))
        .force('x', d3.forceX(width / 2).strength(strengths.x))
        .force('y', d3.forceY(height / 2).strength(strengths.y))
        .force('collision', d3.forceCollide().radius(d => (d.hub ? 45 : 36)))
        .alphaDecay(0.02)
        .on('tick', ticked);

    simulationRef.current = simulation;

    function ticked(){
        // hard rectangular bounds so the graph fills the display instead of
        // drifting into a circular cluster
        nodes.forEach(d => {
            if(d.hub) return;
            d.x = Math.max(pad.x, Math.min(width - pad.x, d.x));
            d.y = Math.max(pad.y, Math.min(height - pad.y, d.y));
        });

        linkSel
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
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
            if(n.hub || n.fx != null) return;
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
Constellation Recall — a small memory game built from the
live topic nodes. The graph flashes a growing pattern; the
player repeats it by clicking the same nodes in order. Every
completed round adds a star and quickens the pace, and the
response window shrinks as the level climbs — one mistake
(or a stalled response) ends the round.
--------------------------------------------------------- */
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
    // stable tone per node id, spread across a pleasant range
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

function startGame(){
    if(graphState.nodes.length < MIN_GAME_NODES) return;
    ensureAudio();

    gameState.active = true;
    gameState.sequence = [];
    gameState.playerIndex = 0;
    gameState.level = 1;
    gameState.score = 0;
    gameState.accepting = false;
    clearTimeout(gameState.responseTimer);

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

function nextRound(){
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
        updateHud('Your turn — repeat the pattern');
        armResponseTimer();
    }, totalTime + 150);
}

function armResponseTimer(){
    clearTimeout(gameState.responseTimer);
    const responseWindow = Math.max(650, 1900 - gameState.level * 35);
    gameState.responseTimer = setTimeout(() => {
        if(gameState.active && gameState.accepting) timeoutFail();
    }, responseWindow);
}

function timeoutFail(){
    const expected = gameState.sequence[gameState.playerIndex];
    flashNode(expected, 'game-wrong', 500);
    endGame(true);
}

function handleGameNodeClick(d){
    if(!gameState.active || !gameState.accepting) return;
    const expected = gameState.sequence[gameState.playerIndex];

    if(d.id === expected){
        flashNode(d.id, 'game-correct', 320);
        playTone(nodeFreq(d.id), 200);
        gameState.score += gameState.level * 10;
        gameState.playerIndex += 1;
        updateHud();

        if(gameState.playerIndex >= gameState.sequence.length){
            gameState.accepting = false;
            clearTimeout(gameState.responseTimer);
            gameState.score += 50;
            gameState.level += 1;
            updateHud('Pattern complete!');
            setTimeout(nextRound, 700);
        } else {
            armResponseTimer();
        }
    } else {
        gameState.accepting = false;
        clearTimeout(gameState.responseTimer);
        flashNode(expected, 'game-flash', 500);
        flashNode(d.id, 'game-wrong', 500);
        playTone(110, 350);
        endGame(true);
    }
}

function endGame(showSummary){
    const wasActive = gameState.active;
    gameState.active = false;
    gameState.accepting = false;
    clearTimeout(gameState.responseTimer);
    document.getElementById('gameHud').hidden = true;
    clearNodeStates();

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
  const sourceSelect = document.getElementById('sourceSelect');

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

  function formatTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }

  function renderSourceSelect() {
    sourceSelect.innerHTML = '';
    currentList().forEach((item, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = item.title || 'Unknown Track';
      sourceSelect.appendChild(opt);
    });
  }

  function setMode(newMode, autoplay) {
    mode = newMode;
    modeToggle.textContent = mode === 'radio' ? '📡' : '🎵';
    modeToggle.classList.toggle('is-radio', mode === 'radio');
    modeToggle.setAttribute('aria-label', mode === 'radio' ? 'Switch to music' : 'Switch to radio');

    [prevBtn, nextBtn, shuffleBtn].forEach(b => b.disabled = mode === 'radio');
    renderSourceSelect();
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
    title.textContent = item.title || 'Unknown Track';
    sourceSelect.value = index;

    progress.style.width = '0%';
    buffered.style.width = '0%';
    title.classList.remove('is-buffering');

    timeCurrent.textContent = '0:00';
    timeDuration.textContent = mode === 'radio' ? 'LIVE' : '0:00';
    progressBar.style.cursor = mode === 'radio' ? 'default' : 'pointer';

    if (autoplay) {
      audio.play().catch((err) => {
        console.error('Playback error:', err);
        title.textContent = 'playback error';
      });
      playBtn.textContent = '❚❚';
      playBtn.setAttribute('aria-label', 'Pause');
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
      audio.play().catch((err) => {
        console.error('Playback error:', err);
        title.textContent = 'playback error';
      });
      playBtn.textContent = '❚❚';
      playBtn.setAttribute('aria-label', 'Pause');
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

  sourceSelect.addEventListener('change', () => {
    loadTrack(parseInt(sourceSelect.value, 10), true);
  });

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