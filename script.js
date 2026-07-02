/* =========================================================
   NODE — personal index
   script.js — graph, nav, content panel, journal log, player
   All content driven by topics.json / diary.json.
   ========================================================= */

const CATEGORY_COLORS = {
  creative: '#ff3fd8',
  systems:  '#4f8bff',
  science:  '#ffd23f',
  personal: '#7dff8a',
  default:  '#4dfff2'
};

const state = {
  topics: [],
  diary: [],
};

/* ---------------------------------------------------------
   Boot
   --------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initContentPanel();
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
    li.innerHTML = `
      <div class="journal-date">${escapeHtml(entry.date)}</div>
      <div class="journal-title">${escapeHtml(entry.title)}</div>
      <div class="journal-text">${escapeHtml(entry.text)}</div>
    `;
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

  const width = section.clientWidth;
  const height = section.clientHeight;

  const svg = d3.select(svgEl)
    .attr('viewBox', [0, 0, width, height]);
  svg.selectAll('*').remove();

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

  // central hub node representing "you" — everything routes through it
  const hub = { id: '__hub__', name: 'NODE', hub: true };
  const nodes = [hub, ...topics.map(t => ({ ...t, id: t.slug }))];
  const links = topics.map(t => ({ source: '__hub__', target: t.slug }));

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
    .attr('r', d => d.hub ? 22 : 13)
    .attr('fill', d => d.hub ? 'rgba(77,255,242,0.12)' : 'rgba(20,26,30,0.9)')
    .attr('stroke', d => d.hub ? '#4dfff2' : (CATEGORY_COLORS[d.category] || CATEGORY_COLORS.default))
    .attr('stroke-width', d => d.hub ? 2 : 1.6)
    .style('filter', d => `drop-shadow(0 0 6px ${d.hub ? '#4dfff2' : (CATEGORY_COLORS[d.category] || CATEGORY_COLORS.default)})`);

  nodeSel.append('text')
    .attr('class', 'node-label')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.hub ? 38 : 26)
    .text(d => d.hub ? '' : d.name);

  nodeSel.filter(d => !d.hub)
    .on('click', (event, d) => openContentPanel(d))
    .on('keydown', (event, d) => {
      if(event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        openContentPanel(d);
      }
    })
    .on('mouseenter', function(){
      d3.select(this).select('circle').transition().duration(150).attr('r', 16);
    })
    .on('mouseleave', function(){
      d3.select(this).select('circle').transition().duration(150).attr('r', 13);
    });

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => 130).strength(0.55))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => (d.hub ? 40 : 34)))
    .alphaDecay(0.02)
    .on('tick', ticked);

  simulationRef.current = simulation;

  function ticked(){
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
        const force = (120 - dist) / 120 * 1.6;
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
    const w = section.clientWidth, h = section.clientHeight;
    svg.attr('viewBox', [0, 0, w, h]);
    simulation.force('center', d3.forceCenter(w / 2, h / 2));
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

/* ---------------------------------------------------------
   Minimal audio player
   --------------------------------------------------------- */
async function initPlayer(){
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
  let mode = 'music'; // 'music' or 'radio'
  let index = 0;
  let shuffle = false;

  try{
    const res = await fetch('assets/audio/playlist.json');
    const data = await res.json();
    library.music = data.tracks || [];
    library.radio = data.radio || [];
  } catch(err){
    console.error('Failed to load playlist.json', err);
  }

  function currentList(){ return library[mode]; }

  function formatTime(sec){
    if(!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function renderSourceSelect(){
    sourceSelect.innerHTML = '';
    currentList().forEach((item, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = item.title;
      sourceSelect.appendChild(opt);
    });
  }

  function setMode(newMode, autoplay){
    mode = newMode;
    modeToggle.textContent = mode === 'radio' ? '📡' : '🎵';
    modeToggle.classList.toggle('is-radio', mode === 'radio');
    modeToggle.setAttribute('aria-label', mode === 'radio' ? 'Switch to music' : 'Switch to radio');
    [prevBtn, nextBtn, shuffleBtn].forEach(b => b.disabled = mode === 'radio');
    renderSourceSelect();
    audio.pause();
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
    if(currentList().length) loadTrack(0, autoplay);
    else title.textContent = mode === 'radio' ? 'no stations — edit playlist.json' : 'no tracks — edit playlist.json';
  }

  function loadTrack(i, autoplay){
    const list = currentList();
    if(!list.length) return;
    index = (i + list.length) % list.length;
    const item = list[index];
    audio.src = item.src;
    title.textContent = item.title;
    sourceSelect.value = index;
    progress.style.width = '0%';
    buffered.style.width = '0%';
    title.classList.remove('is-buffering');
    timeCurrent.textContent = '0:00';
    timeDuration.textContent = mode === 'radio' ? 'LIVE' : '0:00';
    progressBar.style.cursor = mode === 'radio' ? 'default' : 'pointer';
    if(autoplay){
      audio.play().catch(() => {
        title.textContent = `couldn't play — check the stream URL`;
      });
      playBtn.textContent = '❚❚';
      playBtn.setAttribute('aria-label', 'Pause');
    }
  }

  function pickNextIndex(list){
    if(list.length <= 1) return 0;
    if(!shuffle) return (index + 1) % list.length;
    let i;
    do{ i = Math.floor(Math.random() * list.length); } while(i === index);
    return i;
  }

  function next(){
    const list = currentList();
    if(!list.length) return;
    loadTrack(pickNextIndex(list), !audio.paused);
  }
  function prev(){
    loadTrack(index - 1, !audio.paused);
  }

  setMode('music', false);

  modeToggle.addEventListener('click', () => {
    setMode(mode === 'music' ? 'radio' : 'music', true);
  });

  playBtn.addEventListener('click', () => {
    if(!currentList().length) return;
    if(audio.paused){
      audio.play().catch(() => {
        title.textContent = `couldn't play — check the stream URL`;
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
    shuffleBtn.style.color = shuffle ? 'var(--magenta)' : '';
  });

  sourceSelect.addEventListener('change', () => {
    loadTrack(parseInt(sourceSelect.value, 10), true);
  });

  audio.addEventListener('timeupdate', () => {
    if(audio.duration && isFinite(audio.duration)){
      progress.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
      timeCurrent.textContent = formatTime(audio.currentTime);
      timeDuration.textContent = formatTime(audio.duration);
    }
  });

  audio.addEventListener('progress', () => {
    if(audio.duration && isFinite(audio.duration) && audio.buffered.length){
      const end = audio.buffered.end(audio.buffered.length - 1);
      buffered.style.width = `${(end / audio.duration) * 100}%`;
    }
  });

  // slow/interrupted networks: show a "buffering" state instead of looking frozen
  audio.addEventListener('waiting', () => {
    title.classList.add('is-buffering');
  });
  audio.addEventListener('playing', () => {
    title.classList.remove('is-buffering');
  });
  audio.addEventListener('canplay', () => {
    title.classList.remove('is-buffering');
  });

  // auto-retry once on network error (common on flaky connections / dropped radio streams)
  let retried = false;
  audio.addEventListener('error', () => {
    if(retried) {
      title.textContent = mode === 'radio' ? 'stream unavailable' : "couldn't load track";
      return;
    }
    retried = true;
    title.classList.add('is-buffering');
    setTimeout(() => {
      audio.load();
      if(!audio.paused || mode === 'radio') audio.play().catch(() => {});
    }, 1500);
  });
  audio.addEventListener('loadstart', () => { retried = false; });

  progressBar.addEventListener('click', (e) => {
    if(mode === 'radio' || !audio.duration || !isFinite(audio.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  audio.addEventListener('ended', next);

  volume.addEventListener('input', () => {
    audio.volume = parseFloat(volume.value);
  });
}