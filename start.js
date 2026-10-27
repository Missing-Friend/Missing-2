(() => {
  'use strict';

  // =====================================================================
  //  Config
  // =====================================================================
  const MENU_URL = 'index.html';       // where "back to menu" goes
  const NEXT_URL = 'upstairs.html';    // where the stairs lead
  const SAVE_KEY = 'missing2_save';    // the bed saves here
  const RESULT_KEY = 'missing2_part1'; // what upstairs.html can read when this part ends
  const SETTINGS_KEY = 'ducks2_settings';
  const SAFE_CODE = '471';             // box note (4), poster note (7), under the mattress (1)
  const SPEEDRUN_MS = 12 * 60 * 1000;  // finish faster than this for a secret achievement

  const W = 2400;                      // size of the basement
  const H = 1500;
  const R = 14;                        // size of the player for collisions
  const SPEED = 200;                   // walking speed in pixels per second

  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const app = $('app');
  const later = (ms, fn) => setTimeout(fn, ms);

  // =====================================================================
  //  Settings shared with the title screen
  // =====================================================================
  const settings = Object.assign(
    { sound: true, volume: 70 },
    (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })()
  );

  // =====================================================================
  //  The game state (this is what the bed saves)
  // =====================================================================
  function freshState() {
    return {
      v: 1,
      px: 220, py: 440, dir: 'down',
      inv: { rock: false, crowbar: false, tape: false, parts: false, fuse: false, recorder: false, key: false },
      boxes: [false, false, false, false, false],
      digits: { box: false, poster: false, bed: false },
      done: {},
      ach: {},
      info: [],
      flags: {},
      c: { shocks: 0, bumps: 0, windowLooks: 0, knocks: 0, bedUses: 0, mirrorLooks: 0, sweeps: 0 },
      playMs: 0
    };
  }

  let state = freshState();

  function saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.v === 1) return s;
    } catch (e) { /* no save */ }
    return null;
  }

  function adoptSave(s) {
    const f = freshState();
    state = Object.assign(f, s);
    state.inv = Object.assign(freshState().inv, s.inv);
    state.digits = Object.assign(freshState().digits, s.digits);
    state.c = Object.assign(freshState().c, s.c);
    state.flags = Object.assign({}, s.flags);
    state.done = Object.assign({}, s.done);
    state.ach = Object.assign({}, s.ach);
    state.info = Array.isArray(s.info) ? s.info.slice() : [];
    state.boxes = Array.isArray(s.boxes) ? s.boxes.slice() : f.boxes;
  }

  // =====================================================================
  //  Sound (made in the browser, no audio files)
  // =====================================================================
  const audio = (() => {
    let ctx = null;
    let master = null;
    let droneNodes = null;
    let noiseBuf = null;
    let ambientOn = false;

    function ensure() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = settings.sound ? (settings.volume / 100) * 0.9 : 0;
      master.connect(ctx.destination);
      return ctx;
    }

    function running() { return !!ctx && ctx.state === 'running' && settings.sound; }

    function unlock(cb) {
      const c = ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume().then(() => { if (cb) cb(); });
      else if (cb) cb();
    }

    function noise() {
      if (noiseBuf) return noiseBuf;
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    function tone(type, from, to, len, vol) {
      if (!running()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + len);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + len + 0.02);
    }

    function burst(len, vol, filterType, freq, sweepTo) {
      if (!running()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + len + 0.02);
    }

    // A slow, low, cinematic swell for the title
    function drone() {
      if (!running() || droneNodes) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 5);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(180, t);
      f.frequency.linearRampToValueAtTime(1100, t + 8);
      f.connect(g);
      g.connect(master);
      const notes = [[55, 'sawtooth'], [55.4, 'sawtooth'], [82.41, 'sine'], [110, 'sawtooth'], [130.81, 'sine'], [164.81, 'sine'], [207.65, 'sine']];
      const oscs = notes.map(([fr, ty]) => {
        const o = ctx.createOscillator();
        o.type = ty;
        o.frequency.value = fr;
        const og = ctx.createGain();
        og.gain.value = ty === 'sawtooth' ? 0.3 : 0.55;
        o.connect(og);
        og.connect(f);
        o.start(t);
        return o;
      });
      droneNodes = { g, oscs };
    }

    function stopDrone(sec) {
      if (!droneNodes || !ctx) return;
      const t = ctx.currentTime;
      const nodes = droneNodes;
      droneNodes = null;
      nodes.g.gain.cancelScheduledValues(t);
      nodes.g.gain.setValueAtTime(Math.max(0.0001, nodes.g.gain.value), t);
      nodes.g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
      setTimeout(() => nodes.oscs.forEach(o => { try { o.stop(); } catch (e) { /* stopped */ } }), sec * 1000 + 100);
    }

    // A sharp, ugly pluck
    function pluck() {
      if (!running()) return;
      const t = ctx.currentTime;
      [[98, 0.8], [103.8, 0.55], [196, 0.3], [415, 0.12]].forEach(([fr, vol]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(fr * 1.07, t);
        o.frequency.exponentialRampToValueAtTime(fr, t + 0.08);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        o.connect(g);
        g.connect(master);
        o.start(t);
        o.stop(t + 1.9);
      });
      burst(0.4, 0.5, 'highpass', 2600);
    }

    // Low room hum with a drip now and then
    function ambient() {
      if (ambientOn || !running()) return;
      ambientOn = true;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 48;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(master);
      o.start();
      (function drip() {
        later(rnd(4000, 9000), () => { tone('sine', 1300, 650, 0.09, 0.08); drip(); });
      })();
    }

    return {
      ensure, running, unlock, drone, stopDrone, pluck, ambient,
      click: () => tone('square', 900, 700, 0.04, 0.12),
      thud: () => tone('sine', 90, 36, 0.4, 0.7),
      step: () => burst(0.06, 0.12, 'lowpass', 400),
      zap: () => { burst(0.5, 0.7, 'bandpass', 3000, 400); tone('square', 120, 50, 0.5, 0.5); },
      smash: () => { burst(0.7, 0.9, 'highpass', 1800); tone('sine', 140, 50, 0.4, 0.6); },
      squeak: () => { tone('square', 2400, 1800, 0.07, 0.15); later(90, () => tone('square', 2600, 1900, 0.07, 0.15)); },
      chime: () => { tone('sine', 880, 880, 0.35, 0.2); later(120, () => tone('sine', 1320, 1320, 0.5, 0.2)); },
      creak: () => burst(0.9, 0.3, 'bandpass', 300, 900),
      groan: () => tone('sawtooth', 130, 70, 0.9, 0.18),
      staticBurst: () => burst(0.8, 0.5, 'highpass', 800),
      crtOff: () => { tone('sine', 1800, 80, 0.6, 0.3); burst(0.5, 0.3, 'highpass', 3000); },
      rip: () => burst(0.5, 0.35, 'highpass', 1200, 4000)
    };
  })();

  // =====================================================================
  //  Toasts, dialog, panels
  // =====================================================================
  function toast(small, text, kind) {
    const el = document.createElement('div');
    el.className = 'toast-item' + (kind ? ' ' + kind : '');
    const s = document.createElement('small');
    const t = document.createElement('span');
    s.textContent = small;
    t.textContent = text;
    el.appendChild(s);
    el.appendChild(t);
    $('toast').appendChild(el);
    later(3700, () => el.remove());
  }

  // Dialog: lines are strings (narration) or { who, text }
  let dlgActive = false;
  let dlgQueue = [];
  let dlgDone = null;
  let dlgTyping = null;
  let dlgFull = '';

  function say(lines, done) {
    dlgQueue = (Array.isArray(lines) ? lines : [lines]).map(l => (typeof l === 'string' ? { who: '', text: l } : l));
    dlgDone = done || null;
    dlgActive = true;
    $('dialog').classList.add('show');
    nextLine();
  }

  function nextLine() {
    if (!dlgQueue.length) {
      dlgActive = false;
      $('dialog').classList.remove('show');
      const d = dlgDone;
      dlgDone = null;
      if (d) d();
      return;
    }
    const l = dlgQueue.shift();
    $('dlg-who').textContent = l.who || '';
    $('dialog').classList.toggle('narr', !l.who);
    dlgFull = l.text;
    $('dlg-text').textContent = '';
    clearInterval(dlgTyping);
    let i = 0;
    dlgTyping = setInterval(() => {
      i++;
      $('dlg-text').textContent = dlgFull.slice(0, i);
      if (i >= dlgFull.length) { clearInterval(dlgTyping); dlgTyping = null; }
    }, 16);
  }

  function advanceDialog() {
    if (!dlgActive) return;
    if (dlgTyping) {
      clearInterval(dlgTyping);
      dlgTyping = null;
      $('dlg-text').textContent = dlgFull;
    } else {
      nextLine();
    }
  }

  $('dialog').addEventListener('click', advanceDialog);

  let panelOpen = null;

  function openPanel(id) {
    closePanel();
    const p = $(id);
    p.hidden = false;
    panelOpen = p;
    const first = p.querySelector('input, button');
    if (first) first.focus();
  }

  function closePanel() {
    if (!panelOpen) return;
    panelOpen.hidden = true;
    panelOpen = null;
  }

  document.querySelectorAll('.panel-close').forEach(b => b.addEventListener('click', closePanel));

  // A this-or-that choice. The order of the buttons is random.
  function choose(question, a, b, cb) {
    $('choice-q').textContent = question;
    const opts = Math.random() < 0.5 ? [a, b] : [b, a];
    const A = $('choice-a');
    const B = $('choice-b');
    A.textContent = opts[0].label;
    B.textContent = opts[1].label;
    A.onclick = () => { closePanel(); cb(opts[0].value); };
    B.onclick = () => { closePanel(); cb(opts[1].value); };
    openPanel('panel-choice');
    $('panel-choice').dataset.locked = '1';
  }

  // =====================================================================
  //  Objectives, info and achievements
  // =====================================================================
  const nBoxes = () => state.boxes.filter(Boolean).length;
  const nDigits = () => Object.values(state.digits).filter(Boolean).length;

  const TASKS = [
    { id: 'boxes', title: 'Search the boxes', hint: 'Five cardboard boxes are scattered in the middle of the basement.', progress: () => `(${nBoxes()}/5)` },
    { id: 'rock', title: 'Find something to throw', hint: 'A pile of rubble sits in the south of the basement.' },
    { id: 'camera', title: 'Take down the camera', hint: 'It watches from the north wall, in the workshop corner.' },
    { id: 'parts', title: 'Salvage the camera\'s parts', hint: 'Whatever is left of it should be on the floor. Be careful.' },
    { id: 'mirror', title: 'Break the one-way mirror', hint: 'The big mirror on the east wall. You will need something heavy.' },
    { id: 'locker', title: 'Search the room behind the mirror', hint: 'Whoever was watching you had a hiding place.' },
    { id: 'fuse', title: 'Repair the fuse box', hint: 'You will need parts, tape and a fuse.' },
    { id: 'tape', title: 'Play the tape', hint: 'The workbench has an outlet, if it has power.' },
    { id: 'digits', title: 'Find the three digits', hint: 'A box, a wall, a bed.', progress: () => `(${nDigits()}/3)` },
    { id: 'safe', title: 'Open the safe', hint: 'It is in the room behind the mirror.' }
  ];

  const ACH = {
    nick: { name: 'Nick Was Here', desc: 'Look behind a poster. Someone beat you to it.' },
    rat: { name: 'Rat Race', desc: 'Open the wrong box.' },
    hoarder: { name: 'Pack Rat', desc: 'Search every box in the basement.' },
    zap1: { name: 'Shocking Development', desc: 'Get zapped for the first time.' },
    zap5: { name: 'Human Battery', desc: 'Get zapped five times.' },
    dead: { name: 'Dead Eye', desc: 'Take down the camera without getting zapped.' },
    mirror: { name: 'Seven Years Bad Luck', desc: 'Break the mirror.' },
    window: { name: 'Window Shopper', desc: 'Look out the window three times.' },
    knock: { name: 'Knock Knock', desc: 'Try the locked door five times.' },
    sleepy: { name: 'Sleepyhead', desc: 'Use the bed five times.' },
    bonk: { name: 'Hard Head', desc: 'Walk into walls forty times.' },
    fast: { name: 'Speedrunner', desc: 'Escape the basement in under twelve minutes.' },
    looking: { name: 'Looking Good', desc: 'Check yourself out in the mirror three times.' },
    snack: { name: 'Questionable Snack', desc: 'Eat the sandwich.' },
    clean: { name: 'Clean Freak', desc: 'Sweep the floor five times.' }
  };

  function addInfo(text) {
    if (!state.info.includes(text)) state.info.push(text);
  }

  function achieve(id) {
    if (state.ach[id]) return;
    state.ach[id] = true;
    addInfo('Achievement: ' + ACH[id].name);
    toast('Achievement unlocked', ACH[id].name, 'ach');
    audio.chime();
  }

  function completeTask(id) {
    if (state.done[id]) return;
    state.done[id] = true;
    const t = TASKS.find(x => x.id === id);
    toast('Objective complete', t.title);
    audio.chime();
    renderHud();
  }

  function remaining() { return TASKS.filter(t => !state.done[t.id]); }
  function taskTitle(t) { return t.title + (t.progress ? ' ' + t.progress() : ''); }

  function renderHud() {
    const rem = remaining();
    if (rem.length) {
      $('obj-left').textContent = rem.length + (rem.length === 1 ? ' OBJECTIVE LEFT' : ' OBJECTIVES LEFT');
      $('obj-now').textContent = taskTitle(rem[0]);
    } else {
      $('obj-left').textContent = 'FINAL OBJECTIVE';
      $('obj-now').textContent = 'Unlock the main door';
    }
  }

  function renderObjList() {
    const ul = $('obj-list');
    ul.innerHTML = '';
    const rem = remaining();
    if (!rem.length) {
      const li = document.createElement('li');
      li.innerHTML = '<b>Unlock the main door.</b><small>You have the key. Use it on the door in the room you woke up in.</small>';
      ul.appendChild(li);
      return;
    }
    rem.forEach(t => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = taskTitle(t);
      const s = document.createElement('small');
      s.textContent = t.hint;
      li.appendChild(b);
      li.appendChild(s);
      ul.appendChild(li);
    });
  }

  function renderInfo() {
    const fill = (id, items, emptyText, cls) => {
      const ul = $(id);
      ul.innerHTML = '';
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'none';
        li.textContent = emptyText;
        ul.appendChild(li);
        return;
      }
      items.forEach(text => {
        const li = document.createElement('li');
        if (cls) li.className = cls;
        if (typeof text === 'string') {
          li.textContent = text;
        } else {
          const b = document.createElement('b');
          b.textContent = text.name;
          const s = document.createElement('small');
          s.textContent = text.desc;
          li.appendChild(b);
          li.appendChild(s);
        }
        ul.appendChild(li);
      });
    };

    fill('info-done', TASKS.filter(t => state.done[t.id]).map(t => t.title), 'Nothing yet.');

    const got = Object.keys(ACH).filter(id => state.ach[id]).map(id => ACH[id]);
    $('ach-count').textContent = `(${got.length}/${Object.keys(ACH).length})`;
    fill('info-ach', got, 'None yet. Some are hidden well.', 'ach');

    fill('info-list', state.info.filter(t => !t.startsWith('Achievement: ')), 'Nothing yet.');
  }

  // =====================================================================
  //  Quick time events (and the zaps that come with failing them)
  // =====================================================================
  let qteActive = false;
  let qteHandler = null;
  let qteRaf = 0;
  const qteEl = $('qte');

  function doShock(done) {
    state.c.shocks++;
    audio.zap();
    app.classList.remove('shaking');
    void app.offsetWidth;
    app.classList.add('shaking');
    const s = $('shock');
    s.classList.remove('zap');
    void s.offsetWidth;
    s.classList.add('zap');
    achieve('zap1');
    if (state.c.shocks >= 5) achieve('zap5');
    later(1100, () => { if (done) done(); });
  }

  const ARROWS = { up: '\u2191', down: '\u2193', left: '\u2190', right: '\u2192' };
  const DIR_KEYS = { up: ['ArrowUp', 'w'], down: ['ArrowDown', 's'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'] };
  const ALL_DIR_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'];

  function stepPress(s, cb) {
    const fill = $('qte-fill');
    fill.style.display = 'block';
    fill.style.transform = 'scaleX(1)';
    $('qte-zone').style.display = 'none';
    $('qte-marker').style.display = 'none';
    $('qte-prompt').textContent = s.text.replace('{k}', ARROWS[s.dir]);
    const start = performance.now();
    let over = false;

    function finish(ok) {
      if (over) return;
      over = true;
      cancelAnimationFrame(qteRaf);
      qteHandler = null;
      cb(ok);
    }

    qteHandler = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (DIR_KEYS[s.dir].includes(k)) finish(true);
      else if (ALL_DIR_KEYS.includes(k)) finish(false);
    };

    (function tick() {
      const p = (performance.now() - start) / s.time;
      fill.style.transform = `scaleX(${Math.max(0, 1 - p)})`;
      if (p >= 1) finish(false);
      else qteRaf = requestAnimationFrame(tick);
    })();
  }

  function stepTiming(s, cb) {
    const zoneW = s.zone;
    const zl = clamp(rnd(0.15, 0.85) - zoneW / 2, 0.02, 0.98 - zoneW);
    const zone = $('qte-zone');
    const marker = $('qte-marker');
    $('qte-fill').style.display = 'none';
    zone.style.display = 
