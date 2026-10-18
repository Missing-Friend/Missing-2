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
    zone.style.display = 'block';
    zone.style.left = zl * 100 + '%';
    zone.style.width = zoneW * 100 + '%';
    marker.style.display = 'block';
    $('qte-prompt').textContent = s.text;

    let pos = 0;
    let dir = 1;
    let last = performance.now();
    let over = false;
    const start = last;

    function finish(ok) {
      if (over) return;
      over = true;
      cancelAnimationFrame(qteRaf);
      qteHandler = null;
      cb(ok);
    }

    qteHandler = (e) => {
      if (e.key === ' ') finish(pos >= zl && pos <= zl + zoneW);
    };

    (function tick() {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      pos += dir * s.speed * dt;
      if (pos > 1) { pos = 1; dir = -1; }
      if (pos < 0) { pos = 0; dir = 1; }
      marker.style.left = pos * 100 + '%';
      if (now - start > 9000) finish(false);
      else qteRaf = requestAnimationFrame(tick);
    })();
  }

  function stepMash(s, cb) {
    const fill = $('qte-fill');
    fill.style.display = 'block';
    $('qte-zone').style.display = 'none';
    $('qte-marker').style.display = 'none';
    $('qte-prompt').textContent = s.text;
    let value = 0;
    let last = performance.now();
    let over = false;
    const start = last;

    function finish(ok) {
      if (over) return;
      over = true;
      cancelAnimationFrame(qteRaf);
      qteHandler = null;
      cb(ok);
    }

    qteHandler = (e) => {
      if (e.key === ' ') { value = Math.min(1, value + s.gain); audio.click(); }
    };

    (function tick() {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      value = Math.max(0, value - s.decay * dt);
      fill.style.transform = `scaleX(${value})`;
      if (value >= 1) finish(true);
      else if (now - start > s.time) finish(false);
      else qteRaf = requestAnimationFrame(tick);
    })();
  }

  // steps: list of { type: 'press' | 'timing' | 'mash', ... }
  // opts.shock: failing a step zaps you and sends you back to step 1
  function runQTE(title, steps, opts, onWin) {
    qteActive = true;
    qteEl.classList.add('show');
    $('qte-title').textContent = title;
    let i = 0;

    function next() {
      if (i >= steps.length) {
        qteActive = false;
        qteEl.classList.remove('show');
        onWin();
        return;
      }
      const s = steps[i];
      $('qte-note').textContent = steps.length > 1 ? `Step ${i + 1} of ${steps.length}` : '';
      const run = s.type === 'timing' ? stepTiming : s.type === 'mash' ? stepMash : stepPress;
      run(s, (ok) => {
        if (ok) {
          audio.chime();
          i++;
          later(300, next);
        } else {
          fail();
        }
      });
    }

    function fail() {
      if (opts.shock) {
        qteEl.classList.remove('show');
        doShock(() => {
          qteEl.classList.add('show');
          $('qte-prompt').textContent = 'Start over.';
          $('qte-note').textContent = 'You were zapped.';
          i = 0;
          later(1100, next);
        });
      } else {
        $('qte-note').textContent = 'Missed. Try again.';
        later(900, next);
      }
    }

    next();
  }

  const randDir = () => ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];

  // =====================================================================
  //  The basement
  // =====================================================================
  const walls = [
    { x: 0, y: 0, w: W, h: 60 },
    { x: 0, y: H - 60, w: W, h: 60 },
    { x: 0, y: 0, w: 60, h: H },
    { x: W - 60, y: 0, w: 60, h: H },
    // the room you wake up in: doorway on the east wall
    { x: 760, y: 60, w: 40, h: 300 },
    { x: 760, y: 480, w: 40, h: 300 },
    { x: 60, y: 740, w: 740, h: 40 },
    // the room behind the mirror
    { x: 2120, y: 460, w: 220, h: 40 },
    { x: 2120, y: 900, w: 220, h: 40 }
  ];

  const props = [
    { type: 'pillar', x: 1250, y: 560, w: 56, h: 56 },
    { type: 'pillar', x: 1650, y: 860, w: 56, h: 56 },
    { type: 'pillar', x: 1450, y: 1180, w: 56, h: 56 },
    { type: 'pillar', x: 1900, y: 1100, w: 56, h: 56 },
    { type: 'pillar', x: 900, y: 900, w: 56, h: 56 },
    { type: 'pillar', x: 1900, y: 500, w: 56, h: 56 },
    { type: 'barrel', x: 1800, y: 600, w: 44, h: 44 },
    { type: 'barrel', x: 1850, y: 630, w: 44, h: 44 },
    { type: 'barrel', x: 1200, y: 1330, w: 44, h: 44 },
    { type: 'barrel', x: 2020, y: 1300, w: 44, h: 44 }
  ];

  const boxSpots = [[900, 200], [1020, 270], [1140, 210], [960, 380], [1090, 400]];

  const isSolid = (o) => (typeof o.solid === 'function' ? o.solid() : !!o.solid);

  const objs = [
    { id: 'bed', type: 'bed', x: 100, y: 560, w: 200, h: 140, solid: true, reach: 60, label: () => 'Use the bed', act: useBed },
    { id: 'table', type: 'table', x: 560, y: 560, w: 100, h: 80, solid: true, reach: 60, label: () => (state.flags.ate ? 'Look at the table' : 'Look at the sandwich'), act: useSandwich },
    { id: 'broom', type: 'broom', x: 700, y: 590, w: 30, h: 120, solid: false, reach: 50, label: () => 'Grab the broom', act: useBroom },
    { id: 'window', type: 'window', x: 160, y: 28, w: 180, h: 40, solid: false, reach: 80, label: () => 'Look out the window', act: lookWindow },
    { id: 'poster1', type: 'poster', n: 1, x: 410, y: 12, w: 64, h: 84, solid: false, reach: 70, label: () => 'Look behind the poster', act: posterNick },
    { id: 'door', type: 'door', x: 540, y: 10, w: 100, h: 62, solid: false, reach: 90, label: () => (state.inv.key ? 'Unlock the main door' : 'Try the main door'), act: useDoor }
  ];

  boxSpots.forEach((p, i) => {
    objs.push({
      id: 'box' + i, type: 'box', idx: i, x: p[0], y: p[1], w: 70, h: 60, solid: true, reach: 56,
      label: () => (state.boxes[i] ? 'Look in the box again' : 'Search the box'),
      act: () => searchBox(i)
    });
  });

  objs.push(
    { id: 'rubble', type: 'rubble', x: 1000, y: 1250, w: 110, h: 80, solid: true, reach: 56, label: () => (state.inv.rock ? 'Look at the rubble' : 'Search the rubble'), act: useRubble },
    { id: 'camera', type: 'camera', x: 1380, y: 28, w: 60, h: 46, solid: false, reach: 300, enabled: () => !state.flags.cameraDown, label: () => 'Take down the camera', act: useCamera },
    { id: 'wreck', type: 'wreck', x: 1400, y: 300, w: 56, h: 40, solid: false, reach: 60, enabled: () => state.flags.cameraDown && !state.inv.parts, label: () => 'Salvage the camera', act: useWreck },
    { id: 'bench', type: 'bench', x: 1500, y: 70, w: 300, h: 90, solid: true, reach: 70, label: () => 'Use the workbench', act: useBench },
    { id: 'fusebox', type: 'fusebox', x: 1950, y: 28, w: 60, h: 60, solid: false, reach: 90, label: () => 'Open the fuse box', act: useFuse },
    { id: 'poster2', type: 'poster', n: 2, x: 1100, y: 12, w: 64, h: 84, solid: false, reach: 70, label: () => 'Look behind the poster', act: posterWall },
    { id: 'poster3', type: 'poster', n: 3, x: 1700, y: 1396, w: 64, h: 54, solid: false, reach: 70, label: () => 'Look behind the poster', act: posterSpider },
    { id: 'mirror', type: 'mirror', x: 2120, y: 500, w: 30, h: 400, solid: () => !state.flags.mirrorBroken, reach: 100, enabled: () => !state.flags.mirrorBroken, label: () => 'Examine the mirror', act: useMirror },
    { id: 'locker', type: 'locker', x: 2200, y: 540, w: 60, h: 90, solid: true, reach: 56, enabled: () => !!state.flags.mirrorBroken, label: () => (state.flags.lockerOpen ? 'Look in the locker' : 'Search the locker'), act: useLocker },
    { id: 'safe', type: 'safe', x: 2200, y: 760, w: 80, h: 80, solid: true, reach: 56, enabled: () => !!state.flags.mirrorBroken, label: () => (state.inv.key ? 'Look at the safe' : 'Open the safe'), act: useSafe }
  );

  function rectHit(r, px, py) {
    const cx = clamp(px, r.x, r.x + r.w);
    const cy = clamp(py, r.y, r.y + r.h);
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy < R * R;
  }

  function blocked(px, py) {
    for (const w of walls) if (rectHit(w, px, py)) return true;
    for (const p of props) if (rectHit(p, px, py)) return true;
    for (const o of objs) if (isSolid(o) && rectHit(o, px, py)) return true;
    return false;
  }

  function distTo(o) {
    const dx = Math.max(o.x - state.px, 0, state.px - (o.x + o.w));
    const dy = Math.max(o.y - state.py, 0, state.py - (o.y + o.h));
    return Math.hypot(dx, dy);
  }

  let target = null;

  function findTarget() {
    let best = null;
    let bestD = Infinity;
    for (const o of objs) {
      if (o.enabled && !o.enabled()) continue;
      const d = distTo(o);
      if (d <= o.reach && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  // =====================================================================
  //  What you can do in the basement
  // =====================================================================
  function useBed() {
    choose('The mattress is stained, lumpy and yours.',
      { label: 'Rest and save', value: 'save' },
      { label: 'Look under the mattress', value: 'look' },
      (v) => {
        if (v === 'save') {
          state.c.bedUses++;
          saveGame();
          toast('Saved', 'Your progress is saved.');
          audio.chime();
          const lines = state.c.bedUses === 1
            ? ['You lie down for a moment. The mattress smells like a basement, which is fair.']
            : ['You rest for a moment. Somehow it is not any more comfortable.'];
          say(lines.concat(['Game saved.']));
          if (state.c.bedUses >= 5) achieve('sleepy');
        } else if (!state.digits.bed) {
          state.digits.bed = true;
          addInfo('Under the mattress: a scrap of paper with one digit on it: 1.');
          say(['You lift the corner of the mattress. Under it, wedged against the floor: a scrap of paper with a single digit scrawled on it.', { who: 'YOU', text: 'One. Okay. That is... something.' }]);
          checkDigits();
        } else {
          say(['You check under the mattress again. Dust bunnies. They look judgmental.']);
        }
      });
  }

  function checkDigits() {
    if (nDigits() === 3) {
      completeTask('digits');
      addInfo('All three digits found: the box, the poster, the mattress. Maybe in that order.');
    } else {
      renderHud();
    }
  }

  function useSandwich() {
    if (state.flags.ate) { say(['Crumbs. Only crumbs. And regret.']); return; }
    choose('A sandwich sits on the table. It is moving, slightly.',
      { label: 'Eat it', value: 'eat' },
      { label: 'Leave it alone', value: 'leave' },
      (v) => {
        if (v === 'eat') {
          state.flags.ate = true;
          say(['You take a bite. It tastes like regret and the color green.', { who: 'YOU', text: 'I am going to be fine. Probably.' }]);
          achieve('snack');
        } else {
          say([{ who: 'YOU', text: 'Not a chance.' }]);
        }
      });
  }

  function useBroom() {
    state.c.sweeps++;
    const n = state.c.sweeps;
    if (n < 5) {
      say(['You sweep a patch of floor. The dust just moves somewhere else. (' + n + ')']);
    } else if (n === 5) {
      say(['You sweep one last time. The floor is ever so slightly less awful.']);
      achieve('clean');
    } else {
      say(['You are done. The floor is as clean as a basement floor gets.']);
    }
  }

  function lookWindow() {
    state.c.windowLooks++;
    const n = state.c.windowLooks;
    if (n === 1) say(['A narrow window, right at ground level. Outside: grass, and a sky that is the wrong shade of gray. Far too small to climb through.']);
    else if (n === 2) say(['Still grass. Still the wrong gray.']);
    else if (n === 3) { say(['You wave at the grass. The grass does not wave back.']); achieve('window'); }
    else say(['Grass. You are fairly sure it is the same grass.']);
  }

  function posterNick() {
    if (state.flags.nickSeen) { say(['Nick was here. You know that now. You cannot un-know it.']); return; }
    state.flags.nickSeen = true;
    posterScene(() => {
      achieve('nick');
      say([{ who: 'YOU', text: '...Of course.' }]);
    });
  }

  function posterWall() {
    if (state.digits.poster) { say(['The sticky note is still there. 7. You already have it.']); return; }
    state.digits.poster = true;
    addInfo('Behind a poster in the north hall: a sticky note that says: 7.');
    say(['A faded poster for a circus that definitely closed years ago. You peel up a corner. Behind it, stuck to the concrete: a yellow sticky note with one digit.', { who: 'YOU', text: 'Seven. Another one.' }]);
    checkDigits();
  }

  function posterSpider() {
    say(['You peel the poster back. Behind it: a spider. The spider looks at you. You look at the spider. You both agree never to speak of this.']);
  }

  function useDoor() {
    if (!state.inv.key) {
      state.c.knocks++;
      say(['A heavy steel door. No handle on this side, only a brass keyhole, and a tag that says: "Special key only."', { who: 'YOU', text: 'Locked. Obviously.' }]);
      if (state.c.knocks >= 5) achieve('knock');
      return;
    }
    finishPart();
  }

  const BOX_TEXT = [
    ['Under a pile of packing foam: a heavy steel crowbar. Good grip. Bad vibes.', 'crowbar', 'Found a crowbar in a box. It looks heavy enough to break something.'],
    ['A roll of black electrical tape and a handful of loose screws.', 'tape', 'Found electrical tape in a box.'],
    ['A crumpled note in careful handwriting: "FIRST DIGIT: 4. And never cut the red one. RED IS LIVE."', 'digitBox', 'Box note: "FIRST DIGIT: 4. Never cut the red one. RED IS LIVE."'],
    ['Old magazines, a deflated football, and a VHS tape labeled "Learn To Fly Fish (1997)". You do not own a VHS player. You take nothing.', null, null],
    ['You open the flaps and something FURIOUS bursts out. A rat. It looks as surprised as you are.', 'rat', null]
  ];

  function searchBox(i) {
    if (state.boxes[i]) { say(['You already went through this one.']); return; }
    state.boxes[i] = true;
    const [text, kind, info] = BOX_TEXT[i];
    if (kind === 'crowbar') state.inv.crowbar = true;
    if (kind === 'tape') state.inv.tape = true;
    if (kind === 'digitBox') state.digits.box = true;
    if (info) addInfo(info);

    if (kind === 'rat') {
      audio.squeak();
      app.classList.remove('shaking');
      void app.offsetWidth;
      app.classList.add('shaking');
      achieve('rat');
    }

    say([text], () => {
      if (kind === 'digitBox') checkDigits();
      if (nBoxes() === 5) {
        completeTask('boxes');
        achieve('hoarder');
      } else {
        renderHud();
      }
    });
  }

  function useRubble() {
    if (state.inv.rock) { say(['Broken concrete. You already took the best piece.']); return; }
    state.inv.rock = true;
    addInfo('Picked up a rock from the rubble.');
    say(['A pile of broken concrete. One chunk is exactly the right size for throwing. You pick it up.', { who: 'YOU', text: 'Hello, rock.' }], () => completeTask('rock'));
  }

  function useCamera() {
    if (!state.inv.rock) {
      say(['A security camera is bolted high on the wall. Its red light blinks. It is much too high to reach.', { who: 'YOU', text: 'I would need something to throw...' }]);
      return;
    }
    const shocksBefore = state.c.shocks;
    say([
      'A security camera is bolted to the wall. Its red light blinks. Slowly, it turns to face you.',
      { who: 'YOU', text: 'Okay. Rock. Camera. Do not miss.' }
    ], () => {
      runQTE('Take down the camera', [
        { type: 'timing', text: 'Aim! Press SPACE in the green zone.', zone: 0.24, speed: 1.1 },
        { type: 'press', dir: randDir(), text: 'It is charging! Press {k} to dodge!', time: 1400 },
        { type: 'timing', text: 'Throw again! Press SPACE in the green zone.', zone: 0.2, speed: 1.4 }
      ], { shock: true }, () => {
        state.flags.cameraDown = true;
        state.inv.rock = false;
        addInfo('Took down the security camera with a rock.');
        audio.smash();
        say(['The rock smashes straight into the lens. The camera shrieks, shudders, and drops to the floor in a shower of sparks.',
          { who: 'YOU', text: 'Yes!' }], () => {
          completeTask('camera');
          if (state.c.shocks === shocksBefore) achieve('dead');
        });
      });
    });
  }

  function useWreck() {
    say(['The camera lies in pieces on the floor. Wires, a circuit board, a cracked lens. Something inside is still humming.',
      { who: 'YOU', text: 'Careful. Those wires are still live.' }], () => {
      const steps = [];
      const names = { up: 'RED', down: 'BLUE', left: 'GREEN', right: 'YELLOW' };
      for (let i = 0; i < 5; i++) {
        const d = randDir();
        steps.push({ type: 'press', dir: d, text: `Cut the ${names[d]} wire! Press {k}`, time: Math.max(900, 1500 - i * 130) });
      }
      runQTE('Salvage the camera', steps, { shock: true }, () => {
        state.inv.parts = true;
        addInfo('Salvaged a circuit board and wiring from the camera.');
        say(['The last wire comes free. You pocket the board and as much wiring as you can carry.', { who: 'YOU', text: 'This should be useful for something.' }], () => completeTask('parts'));
      });
    });
  }

  function useMirror() {
    choose('A huge mirror covers most of the east wall. Your reflection stares back.',
      { label: 'Look at yourself', value: 'look' },
      { label: 'Break it', value: 'break' },
      (v) => {
        if (v === 'look') {
          state.c.mirrorLooks++;
          const n = state.c.mirrorLooks;
          if (n === 1) say([{ who: 'YOU', text: 'I look terrible.' }]);
          else if (n === 2) say([{ who: 'YOU', text: 'Still terrible. Slightly better lighting.' }]);
          else { say([{ who: 'YOU', text: 'Honestly? Not bad.' }]); achieve('looking'); }
          return;
        }
        if (!state.inv.crowbar) {
          say(['You punch the glass. Your fist bounces off.', { who: 'YOU', text: 'Ow. I need something heavy.' }]);
          return;
        }
        say(['You grip the crowbar with both hands and draw back.'], () => {
          runQTE('Break the mirror', [{ type: 'mash', text: 'SMASH IT! Hammer SPACE!', gain: 0.085, decay: 0.2, time: 7000 }], { shock: false }, () => {
            state.flags.mirrorBroken = true;
            addInfo('The one-way mirror is smashed. There is a room behind it.');
            audio.smash();
            app.classList.remove('shaking');
            void app.offsetWidth;
            app.classList.add('shaking');
            achieve('mirror');
            say(['The whole mirror cracks, spiders, and collapses in a roar of glass.',
              'Behind it: a tiny room with a metal locker and a safe. A chair faces the glass. Someone was sitting here, watching you.',
              { who: 'YOU', text: 'Someone has been watching me.' }], () => completeTask('mirror'));
          });
        });
      });
  }

  function useLocker() {
    if (state.flags.lockerOpen) { say(['The locker is empty now, apart from a few sunflower seed shells.']); return; }
    state.flags.lockerOpen = true;
    state.inv.fuse = true;
    state.inv.recorder = true;
    addInfo('Found a spare fuse and a tape recorder in the locker behind the mirror.');
    say(['The locker creaks open. Inside: a small tape recorder, a spare fuse, a pair of binoculars, and a pile of sunflower seed shells.',
      { who: 'YOU', text: 'They really did watch me. Snacking.' }], () => completeTask('locker'));
  }

  function useFuse() {
    if (state.flags.powered) { say(['The fuse box hums happily. The little light is green.']); return; }
    const missing = [];
    if (!state.inv.parts) missing.push('circuit board');
    if (!state.inv.tape) missing.push('electrical tape');
    if (!state.inv.fuse) missing.push('fuse');
    if (missing.length) {
      say(['A fuse box, dead and cold. A burnt-out fuse sits in the slot and the wiring has been torn.',
        { who: 'YOU', text: 'I would need a circuit board, tape, and a fuse. Still missing: ' + missing.join(', ') + '.' }]);
      return;
    }
    say(['You fit the fuse, splice the camera board into the wiring, and wrap it all in tape. Two wires remain, one red and one blue. One of them is live.']);
    later(50, askWire);
  }

  function askWire() {
    // wait for the dialog to finish before showing the choice
    if (dlgActive) { later(150, askWire); return; }
    choose('Which wire do you cut?',
      { label: 'Cut the red wire', value: 'red' },
      { label: 'Cut the blue wire', value: 'blue' },
      (v) => {
        if (v === 'blue') {
          state.flags.powered = true;
          addInfo('Repaired the fuse box. The lights are on in the workshop.');
          say(['Snip. For a long moment, nothing. Then every bulb in the basement stutters, buzzes, and blazes on.', { who: 'YOU', text: 'Yes! Lights!' }], () => completeTask('fuse'));
        } else {
          doShock(() => {
            say(['Snip. Red. The live one.', { who: 'YOU', text: 'Ow. Ow. I knew that.' }, 'The wires are still waiting for you.']);
          });
        }
      });
  }

  function useBench() {
    if (!state.inv.recorder) {
      say(['A workbench covered in rust, wire, and one lonely screw. There is an outlet on the wall behind it.']);
      return;
    }
    if (!state.flags.powered) {
      say(['You set the tape recorder on the bench and flick the switch. Nothing.', { who: 'YOU', text: 'It needs power.' }]);
      return;
    }
    if (state.flags.tapePlayed) { say(['The tape is blank now. The Voice has said its piece.']); return; }
    playTape();
  }

  function playTape() {
    say(['You plug in the recorder. A click. Then a calm, warm, wrong voice.',
      { who: 'THE VOICE', text: 'Hello. I hope you slept well. I would know. I watched you sleep.' },
      { who: 'THE VOICE', text: 'You have been busy. Boxes. Rocks. Broken glass. Impressive. Rude, but impressive.' },
      { who: 'THE VOICE', text: 'The key to the door is in my safe. Three digits: a box, a wall, a bed. In that order.' },
      { who: 'THE VOICE', text: 'I like you. So I will offer you something. A gift, or the truth. Choose.' }
    ], () => {
      choose('The Voice waits.',
        { label: 'Take the gift', value: 'gift' },
        { label: 'Hear the truth', value: 'truth' },
        (v) => {
          state.flags.tapePlayed = true;
          state.flags.tapeChoice = v;
          if (v === 'gift') {
            addInfo('The Voice gave you a gift: one of the digits is behind a poster in the north hall.');
            say([{ who: 'THE VOICE', text: 'A gift it is. The second digit hides behind a poster in the north hall.' }, { who: 'THE VOICE', text: 'You are welcome.' }], () => completeTask('tape'));
          } else {
            addInfo('The Voice told you the truth: you are not the first to wake up here. The last one never made it past the top of the stairs.');
            say([{ who: 'THE VOICE', text: 'The truth: you are not the first to wake up here. The last one did not make it past the top of the stairs.' }, { who: 'THE VOICE', text: 'Do not say I never told you.' }], () => completeTask('tape'));
          }
        });
    });
  }

  function useSafe() {
    if (state.inv.key) { say(['The safe is open and empty. The velvet cushion looks lonely.']); return; }
    $('code-input').value = '';
    $('code-feedback').textContent = '';
    openPanel('panel-code');
    $('code-input').focus();
  }

  function tryCode() {
    const v = $('code-input').value.trim();
    if (v === SAFE_CODE) {
      closePanel();
      state.inv.key = true;
      addInfo('Opened the safe and took The Mysterious Key.');
      audio.creak();
      say(['The dial clicks. The door swings open. Inside, on a velvet cushion that looks absurdly expensive: a single brass key with a paper tag.',
        'The tag says: "THE MYSTERIOUS KEY".',
        { who: 'YOU', text: 'That is the door key. That has to be the door key.' }], () => completeTask('safe'));
    } else {
      $('code-feedback').textContent = 'Click. Nothing. Wrong.';
    }
  }

  // =====================================================================
  //  Drawing
  // =====================================================================
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const lightCanvas = document.createElement('canvas');
  const lctx = lightCanvas.getContext('2d');
  let camX = 0;
  let camY = 0;
  let walkAnim = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    lightCanvas.width = canvas.width;
    lightCanvas.height = canvas.height;
  }
  window.addEventListener('resize', resize);
  resize();

  // The concrete floor
  const tile = document.createElement('canvas');
  tile.width = 256;
  tile.height = 256;
  (function makeTile() {
    const t = tile.getContext('2d');
    t.fillStyle = '#4b4e4d';
    t.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const g = Math.floor(rnd(50, 110));
      t.fillStyle = `rgba(${g},${g},${g},0.18)`;
      t.fillRect(rnd(0, 256), rnd(0, 256), rnd(1, 3), rnd(1, 3));
    }
    t.strokeStyle = 'rgba(0,0,0,0.25)';
    t.lineWidth = 2;
    t.strokeRect(0, 0, 256, 256);
    t.beginPath();
    t.moveTo(0, 128); t.lineTo(256, 128);
    t.moveTo(128, 0); t.lineTo(128, 256);
    t.stroke();
  })();
  const floorPattern = ctx.createPattern(tile, 'repeat');

  const stains = [];
  for (let i = 0; i < 18; i++) stains.push({ x: rnd(120, W - 120), y: rnd(120, H - 120), rx: rnd(30, 90), ry: rnd(16, 50) });

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFloor() {
    ctx.fillStyle = floorPattern;
    ctx.fillRect(60, 60, W - 120, H - 120);
    ctx.fillStyle = 'rgba(40,60,90,0.10)';
    ctx.fillRect(60, 60, 700, 680);
    stains.forEach(s => {
      ctx.fillStyle = 'rgba(8,12,10,0.22)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // the room behind the mirror, once it is open
    if (state.flags.mirrorBroken) {
      ctx.fillStyle = '#34383a';
      ctx.fillRect(2150, 500, 190, 400);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(2150, 500, 190, 400);
      ctx.fillStyle = '#5a4a32';
      rr(2170, 680, 36, 40, 6); ctx.fill();
    }
  }

  function drawWalls() {
    walls.forEach(w => {
      ctx.fillStyle = '#2b2e2e';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = '#3d4141';
      ctx.fillRect(w.x, w.y, w.w, Math.min(6, w.h));
    });
    // pipes along the north wall
    ctx.fillStyle = '#23272a';
    ctx.fillRect(800, 20, W - 860, 12);
    ctx.fillStyle = '#383e42';
    ctx.fillRect(800, 20, W - 860, 4);
    // the closet is just wall until the mirror breaks
    if (!state.flags.mirrorBroken) {
      ctx.fillStyle = '#2b2e2e';
      ctx.fillRect(2150, 500, 190, 400);
    }
  }

  function drawProps() {
    props.forEach(p => {
      if (p.type === 'pillar') {
        ctx.fillStyle = '#34383a';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#4a4f50';
        ctx.fillRect(p.x, p.y, p.w, 6);
        ctx.strokeStyle = '#1d2021';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
      } else {
        ctx.fillStyle = '#31414a';
        ctx.beginPath();
        ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1b262c';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#425763';
        ctx.beginPath();
        ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 2 - 8, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawObj(o, t) {
    if (o.enabled && !o.enabled() && o.type !== 'camera' && o.type !== 'mirror') return;
    switch (o.type) {
      case 'bed': {
        ctx.fillStyle = '#6d6757';
        rr(o.x, o.y, o.w, o.h, 10); ctx.fill();
        ctx.fillStyle = '#3f3220';
        ctx.beginPath(); ctx.ellipse(o.x + 110, o.y + 80, 50, 22, 0.2, 0, 7); ctx.fill();
        ctx.fillStyle = '#7b7a72';
        rr(o.x + 10, o.y + 10, 56, 38, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'table': {
        ctx.fillStyle = '#5c4a32';
        rr(o.x, o.y, o.w, o.h, 6); ctx.fill();
        ctx.fillStyle = '#463725';
        ctx.fillRect(o.x, o.y + o.h - 8, o.w, 8);
        if (!state.flags.ate) {
          ctx.fillStyle = '#b9ab72';
          rr(o.x + 30, o.y + 22, 40, 26, 5); ctx.fill();
          ctx.fillStyle = '#5f7a3a';
          ctx.fillRect(o.x + 34, o.y + 30, 32, 6);
        }
        ctx.fillStyle = '#4a3a28';
        rr(o.x - 36, o.y + 18, 28, 28, 6); ctx.fill();
        break;
      }
      case 'broom': {
        ctx.strokeStyle = '#8c7a4a';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(o.x + 10, o.y); ctx.lineTo(o.x + 14, o.y + 90); ctx.stroke();
        ctx.fillStyle = '#a89a5a';
        ctx.fillRect(o.x - 2, o.y + 86, 32, 28);
        break;
      }
      case 'window': {
        ctx.fillStyle = '#0b1118';
        ctx.fillRect(o.x - 6, o.y - 4, o.w + 12, o.h + 8);
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        g.addColorStop(0, '#cfe3f5'); g.addColorStop(1, '#8fb0d0');
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#1a1d1e';
        [60, 120].forEach(dx => ctx.fillRect(o.x + dx - 3, o.y, 6, o.h));
        break;
      }
      case 'poster': {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.fillStyle = o.n === 1 ? '#e8dcb9' : o.n === 2 ? '#d9cfae' : '#cfc5a4';
        ctx.fillRect(0, 0, o.w, o.h);
        ctx.fillStyle = '#7a2a2a';
        ctx.fillRect(8, 8, o.w - 16, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(10, 30, o.w - 20, o.h - 44);
        ctx.restore();
        break;
      }
      case 'door': {
        ctx.fillStyle = '#2a2e32';
        ctx.fillRect(o.x - 8, o.y, o.w + 16, o.h + 10);
        const g = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
        g.addColorStop(0, '#4b535b'); g.addColorStop(0.5, '#69727b'); g.addColorStop(1, '#4b535b');
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h + 6);
        ctx.fillStyle = '#c9a54a';
        ctx.beginPath(); ctx.arc(o.x + o.w - 22, o.y + 34, 7, 0, 7); ctx.fill();
        ctx.fillRect(o.x + o.w - 24, o.y + 38, 4, 12);
        break;
      }
      case 'box': {
        const open = state.boxes[o.idx];
        ctx.fillStyle = open ? '#6a5233' : '#8a6a42';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#4b3a23';
        ctx.lineWidth = 3;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = open ? '#2d2314' : '#a68458';
        ctx.fillRect(o.x + 8, o.y + 8, o.w - 16, o.h - 16);
        if (!open) {
          ctx.fillStyle = '#c8b27a';
          ctx.fillRect(o.x + o.w / 2 - 4, o.y, 8, o.h);
        }
        break;
      }
      case 'rubble': {
        ctx.fillStyle = '#4b4d4d';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y + o.h); ctx.lineTo(o.x + 20, o.y + 20); ctx.lineTo(o.x + 60, o.y + 4);
        ctx.lineTo(o.x + 96, o.y + 30); ctx.lineTo(o.x + o.w, o.y + o.h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#626565';
        ctx.fillRect(o.x + 28, o.y + 40, 24, 16);
        if (!state.inv.rock) {
          ctx.fillStyle = '#8a8d8c';
          ctx.beginPath(); ctx.ellipse(o.x + 62, o.y + 26, 18, 13, 0.3, 0, 7); ctx.fill();
        }
        break;
      }
      case 'camera': {
        if (state.flags.cameraDown) break;
        ctx.fillStyle = '#16181a';
        rr(o.x, o.y, o.w, o.h, 8); ctx.fill();
        ctx.fillStyle = '#0a0b0c';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h - 8, 14, 0, 7); ctx.fill();
        ctx.fillStyle = '#34414b';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h - 8, 7, 0, 7); ctx.fill();
        break;
      }
      case 'wreck': {
        ctx.fillStyle = '#1a1c1e';
        ctx.fillRect(o.x, o.y + 8, o.w, o.h - 8);
        ctx.fillStyle = '#3b6a4a';
        ctx.fillRect(o.x + 6, o.y, 26, 16);
        ctx.strokeStyle = '#b84a3a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(o.x + 4, o.y + 22); ctx.lineTo(o.x - 22, o.y + 34); ctx.stroke();
        ctx.strokeStyle = '#3a6ab8';
        ctx.beginPath(); ctx.moveTo(o.x + o.w, o.y + 26); ctx.lineTo(o.x + o.w + 26, o.y + 10); ctx.stroke();
        if (Math.sin(t / 90) > 0.6) {
          ctx.fillStyle = '#bfe8ff';
          ctx.fillRect(o.x + 18 + rnd(-12, 12), o.y + rnd(-6, 8), 5, 5);
        }
        break;
      }
      case 'bench': {
        ctx.fillStyle = '#6a4f32';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#4a3723';
        ctx.fillRect(o.x, o.y + o.h - 10, o.w, 10);
        ctx.fillStyle = '#3a3c3e';
        ctx.fillRect(o.x + 20, o.y + 24, 50, 14);
        ctx.fillRect(o.x + 140, o.y + 40, 70, 10);
        ctx.fillStyle = '#7c8083';
        ctx.fillRect(o.x + 230, o.y + 20, 30, 30);
        break;
      }
      case 'fusebox': {
        ctx.fillStyle = '#3a3e41';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#1b1d1f';
        ctx.lineWidth = 3;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = state.flags.powered ? '#4fd36c' : '#d34f4f';
        ctx.beginPath(); ctx.arc(o.x + 14, o.y + 14, 5, 0, 7); ctx.fill();
        ctx.fillStyle = '#25282a';
        ctx.fillRect(o.x + 10, o.y + 28, o.w - 20, 22);
        break;
      }
      case 'mirror': {
        if (state.flags.mirrorBroken) {
          ctx.fillStyle = 'rgba(180,210,230,0.5)';
          [[2118, 520, 14, 30], [2128, 640, 12, 24], [2120, 760, 16, 28], [2130, 840, 10, 30]].forEach(s => ctx.fillRect(s[0], s[1], s[2], s[3]));
          break;
        }
        const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
        g.addColorStop(0, '#5f7a8c'); g.addColorStop(0.5, '#9ab8cc'); g.addColorStop(1, '#4a6070');
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#1e2224';
        ctx.lineWidth = 5;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(o.x + 6, o.y + 40); ctx.lineTo(o.x + 24, o.y + 20); ctx.stroke();
        break;
      }
      case 'locker': {
        ctx.fillStyle = '#4c5258';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#25292d';
        ctx.lineWidth = 3;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#2d3135';
        for (let i = 0; i < 4; i++) ctx.fillRect(o.x + 10, o.y + 12 + i * 8, o.w - 20, 3);
        if (state.flags.lockerOpen) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, o.h - 12); }
        break;
      }
      case 'safe': {
        ctx.fillStyle = '#26292c';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 4;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = state.inv.key ? '#1a1c1e' : '#6c7176';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 18, 0, 7); ctx.fill();
        ctx.fillStyle = '#c9a54a';
        ctx.fillRect(o.x + o.w / 2 - 2, o.y + o.h / 2 - 16, 4, 14);
        break;
      }
      default: break;
    }
  }

  function drawPlayer() {
    const x = state.px;
    const y = state.py;
    const bob = Math.sin(walkAnim) * 1.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 9, 16, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a5a6b';
    ctx.beginPath(); ctx.ellipse(0, 2 + bob * 0.4, 15, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#c9a283';
    ctx.beginPath(); ctx.arc(-13, 3 - bob, 4.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(13, 3 + bob, 4.5, 0, 7); ctx.fill();
    const off = { up: [0, -3], down: [0, 3], left: [-3, 0], right: [3, 0] }[state.dir];
    ctx.fillStyle = '#c9a283';
    ctx.beginPath(); ctx.arc(off[0], off[1] - 5 + bob * 0.4, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#1f1a17';
    ctx.beginPath();
    if (state.dir === 'down') ctx.arc(0, -10 + bob * 0.4, 10, Math.PI * 1.05, Math.PI * 1.95);
    else if (state.dir === 'up') ctx.arc(0, -7 + bob * 0.4, 10, 0, Math.PI * 2);
    else ctx.arc(off[0] + (state.dir === 'left' ? 3 : -3), -6 + bob * 0.4, 10, 0, Math.PI * 2);
    ctx.fill();
    if (state.dir === 'down' || state.dir === 'left' || state.dir === 'right') {
      ctx.fillStyle = '#2a1f1a';
      const ex = state.dir === 'down' ? [-4, 4] : [off[0] + (state.dir === 'left' ? -2 : 2)];
      ex.forEach(e => ctx.fillRect(e - 1, off[1] - 5 + bob * 0.4, 2, 3));
    }
    ctx.restore();
  }

  function hole(x, y, r, a) {
    const g = lctx.createRadialGradient(x, y, r * 0.12, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(x, y, r, 0, Math.PI * 2);
    lctx.fill();
  }

  function drawLighting(t) {
    const vw = canvas.width;
    const vh = canvas.height;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, vw, vh);
    lctx.fillStyle = 'rgba(0,0,0,0.9)';
    lctx.fillRect(0, 0, vw, vh);
    lctx.globalCompositeOperation = 'destination-out';
    hole(state.px - camX, state.py - camY, 250, 1);
    hole(250 - camX, 300 - camY, 240, 0.8); // the window shaft
    if (state.flags.powered) {
      const f = 0.94 + Math.sin(t / 130) * 0.03;
      hole(1650 - camX, 230 - camY, 440, f);
      hole(1100 - camX, 330 - camY, 380, f * 0.95);
      hole(2000 - camX, 170 - camY, 280, f * 0.9);
    }
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  function glow(x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(t) {
    const vw = canvas.width;
    const vh = canvas.height;
    camX = clamp(state.px - vw / 2, 0, Math.max(0, W - vw));
    camY = clamp(state.py - vh / 2, 0, Math.max(0, H - vh));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(-camX, -camY);

    drawFloor();
    drawWalls();
    drawProps();
    objs.forEach(o => drawObj(o, t));
    drawPlayer();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawLighting(t);

    // Things that glow in the dark
    ctx.translate(-camX, -camY);
    if (!state.flags.cameraDown) {
      const a = 0.55 + 0.45 * Math.sin(t / 280);
      glow(1410, 56, 46, `rgba(255,40,40,${(a * 0.7).toFixed(2)})`);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // =====================================================================
  //  Input and the game loop
  // =====================================================================
  const keys = { up: false, down: false, left: false, right: false };
  const keyMap = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
  let cinema = false;
  let playing = false;
  let wasHit = false;
  let stepTimer = 0;

  const busy = () => dlgActive || qteActive || !!panelOpen || cinema || !playing;

  function interact() {
    if (busy() || !target) return;
    audio.click();
    target.act();
  }

  function openObjectives() {
    if (busy()) return;
    renderObjList();
    openPanel('panel-obj');
  }

  function openInfo() {
    if (busy()) return;
    renderInfo();
    openPanel('panel-info');
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (introSkip && k === 'Escape') { introSkip(); return; }

    if (qteActive) {
      if (qteHandler && !e.repeat) { e.preventDefault(); qteHandler(e); }
      else if (k === ' ') e.preventDefault();
      return;
    }
    if (dlgActive) {
      if (k === 'e' || k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) advanceDialog(); }
      return;
    }
    if (panelOpen) {
      if (k === 'Escape' && !panelOpen.dataset.locked) closePanel();
      if (k === 'Enter' && panelOpen.id === 'panel-code') tryCode();
      return;
    }
    if (cinema || !playing) return;

    if (keyMap[k]) { keys[keyMap[k]] = true; e.preventDefault(); }
    if ((k === 'e' || k === 'Enter' || k === ' ') && !e.repeat) { e.preventDefault(); interact(); }
    if (k === 'i' && !e.repeat) openInfo();
    if (k === 'o' && !e.repeat) openObjectives();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (keyMap[k]) keys[keyMap[k]] = false;
  });

  window.addEventListener('blur', () => { keys.up = keys.down = keys.left = keys.right = false; });

  function update(dt) {
    state.playMs += dt * 1000;

    let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      state.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }

    const sp = SPEED * dt;
    let hit = false;
    const nx = state.px + dx * sp;
    if (blocked(nx, state.py)) hit = hit || dx !== 0;
    else state.px = nx;
    const ny = state.py + dy * sp;
    if (blocked(state.px, ny)) hit = hit || dy !== 0;
    else state.py = ny;

    if (hit && !wasHit) {
      state.c.bumps++;
      if (state.c.bumps >= 40) achieve('bonk');
    }
    wasHit = hit;

    if (dx || dy) {
      walkAnim += dt * 11;
      stepTimer -= dt;
      if (stepTimer <= 0) { audio.step(); stepTimer = 0.34; }
    }
  }

  function updatePrompt() {
    if (busy()) { target = null; $('prompt').classList.remove('show'); return; }
    target = findTarget();
    if (target) {
      $('prompt').textContent = 'E: ' + target.label();
      $('prompt').classList.add('show');
    } else {
      $('prompt').classList.remove('show');
    }
  }

  let last = performance.now();

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!busy()) update(dt);
    updatePrompt();
    draw(t);
    requestAnimationFrame(frame);
  }

  // =====================================================================
  //  The poster scene: graffiti, then an eye roll
  // =====================================================================
  function posterScene(done) {
    cinema = true;
    const pv = $('poster-view');
    const fv = $('face-view');
    pv.classList.remove('zoom', 'peel');
    fv.classList.remove('roll', 'turn');
    pv.classList.add('show');
    later(100, () => pv.classList.add('zoom'));
    later(1700, () => { audio.rip(); pv.classList.add('peel'); });
    later(3900, () => { fv.classList.add('show'); });
    later(4100, () => { pv.classList.remove('show'); });
    later(4500, () => fv.classList.add('roll'));
    later(6600, () => fv.classList.add('turn'));
    later(7700, () => fv.classList.remove('show'));
    later(8300, () => {
      fv.classList.remove('roll', 'turn');
      cinema = false;
      done();
    });
  }

  // =====================================================================
  //  The end of this part: up the stairs and into the light
  // =====================================================================
  function figureMarkup() {
    return `
      <svg viewBox="0 0 60 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g class="sleg sla"><rect x="17" y="80" width="11" height="46" rx="4" fill="#26324a"/></g>
        <g class="sleg slb"><rect x="32" y="80" width="11" height="46" rx="4" fill="#26324a"/></g>
        <rect x="14" y="36" width="32" height="48" rx="10" fill="#4a5a6b"/>
        <rect x="6" y="40" width="11" height="40" rx="5" fill="#435260"/>
        <rect x="43" y="40" width="11" height="40" rx="5" fill="#435260"/>
        <circle cx="11.500" cy="82" r="6.500" fill="#c9a283"/>
        <circle cx="48.500" cy="82" r="6.500" fill="#c9a283"/>
        <circle cx="33" cy="23" r="11" fill="#c9a283"/>
        <path d="M21 21 Q22 8 34 9 Q46 10 44 21 Q38 13 31 14 Q25 15 21 21 Z" fill="#1f1a17"/>
        <circle cx="37.500" cy="23" r="1.300" fill="#222"/>
      </svg>`;
  }

  function finishPart() {
    cinema = true;
    state.flags.unlocked = true;
    if (state.playMs < SPEEDRUN_MS) achieve('fast');
    addInfo('Unlocked the main door with The Mysterious Key.');

    try {
      localStorage.setItem(RESULT_KEY, JSON.stringify({
        flags: state.flags,
        ach: state.ach,
        info: state.info,
        counters: state.c,
        playMs: Math.round(state.playMs),
        done: state.done
      }));
    } catch (e) { /* storage blocked */ }
    saveGame();

    audio.creak();
    $('hud').classList.remove('on');
    $('prompt').classList.remove('show');
    cinema = false;
    say(['You slide the key into the lock. It turns with a heavy, satisfying clunk.', 'The door groans open on a staircase leading up into the cold.'], () => {
      cinema = true;
      stairsScene();
    });
  }

  function stairsScene() {
    const el = $('stairs');
    const world = $('stairs-world');
    const light = $('stairs-light');
    const white = $('stairs-white');
    const N = 14;
    const SW = 120;
    const SH = 70;
    const base = 1000;

    world.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const s = document.createElement('div');
      s.className = 'step';
      s.style.left = 300 + i * SW + 'px';
      s.style.top = base - i * SH + 'px';
      s.style.width = SW + 900 + 'px';
      s.style.height = 1400 + 'px';
      world.appendChild(s);
    }
    const fig = document.createElement('div');
    fig.id = 'stairs-figure';
    fig.innerHTML = figureMarkup();
    world.appendChild(fig);

    const place = (i) => {
      const x = 300 + i * SW + 30;
      const y = base - i * SH - 113;
      fig.style.left = x + 'px';
      fig.style.top = y + 'px';
      world.style.transform = `translate(${window.innerWidth * 0.4 - x}px, ${window.innerHeight * 0.62 - y}px)`;
    };

    world.style.transition = 'none';
    fig.style.transition = 'none';
    place(0);
    el.classList.add('show');

    later(120, () => {
      world.style.transition = '';
      fig.style.transition = '';
    });

    for (let i = 1; i <= N; i++) {
      later(1000 + i * 480, () => {
        fig.classList.add('walk');
        place(Math.min(i, N - 1) + (i === N ? 0.8 : 0));
        light.style.opacity = String(Math.min(1, i / N));
        audio.step();
        later(180, () => audio.step());
      });
    }

    later(1000 + N * 480 + 500, () => {
      white.classList.add('on');
      audio.creak();
    });
    later(1000 + N * 480 + 2600, () => { window.location.href = NEXT_URL; });
  }

  // =====================================================================
  //  Back to the menu: glitch, then the screen shuts off like an old TV
  // =====================================================================
  function quitToMenu() {
    closePanel();
    cinema = true;
    app.classList.add('glitch');
    audio.staticBurst();
    later(1300, () => {
      app.classList.remove('glitch');
      app.classList.add('crt-off');
      audio.crtOff();
    });
    later(2200, () => { window.location.href = MENU_URL; });
  }

  $('obj-box').addEventListener('click', (e) => { e.currentTarget.blur(); openObjectives(); });
  $('btn-info').addEventListener('click', (e) => { e.currentTarget.blur(); openInfo(); });
  $('btn-menu').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (busy()) return;
    openPanel('panel-menu');
  });
  $('menu-no').addEventListener('click', closePanel);
  $('menu-yes').addEventListener('click', quitToMenu);
  $('code-ok').addEventListener('click', tryCode);

  // =====================================================================
  //  The intro: a white screen, the title, then the dark basement
  // =====================================================================
  let introSkip = null;
  let introTimers = [];
  const at = (ms, fn) => { introTimers.push(setTimeout(fn, ms)); };

  function startIntroAudio() {
    audio.ensure();
    if (audio.running()) { audio.drone(); return; }
    at(700, () => { if (!audio.running()) $('sound-hint').classList.add('show'); });
    const unlock = () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      audio.unlock(() => { audio.drone(); $('sound-hint').classList.remove('show'); });
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  function runIntro(canSkip) {
    startIntroAudio();
    introSkip = canSkip ? skipIntro : null;

    // The white screen from the title screen. The title fades in slowly.
    at(1200, () => $('t-title').classList.add('show'));
    at(5800, () => $('t-sub').classList.add('show'));

    // A sharp pluck, then black
    at(8800, () => audio.pluck());
    at(9800, () => {
      audio.stopDrone(3);
      $('white').classList.add('dark');
    });

    // Into the dark
    at(11700, () => {
      $('pov').classList.add('show');
      later(200, () => $('white').classList.add('gone'));
      runPov();
    });
  }

  function runPov() {
    const world = $('pov-world');
    const top = $('pov-lid-top');
    const bottom = $('pov-lid-bottom');
    const sub = $('pov-sub');

    const lids = (cls) => { top.className = cls; bottom.className = cls; };

    // Eyes open in two tries
    at(700, () => lids('ajar'));
    at(1300, () => lids(''));
    at(1900, () => lids('open'));
    at(600, () => world.classList.add('clear'));

    // Look left, toward the mattress
    at(2600, () => { world.style.transitionDuration = '2.4s'; world.style.transform = 'translate(-10vw, -70vh)'; });
    // Look right, toward the door
    at(5400, () => { world.style.transitionDuration = '2.8s'; world.style.transform = 'translate(-190vw, -40vh)'; });
    // Look up, at the window: the only light in the room
    at(8800, () => { world.style.transitionDuration = '2.6s'; world.style.transform = 'translate(-5vw, 0vh)'; });

    // Speak
    at(11800, () => {
      audio.groan();
      const text = 'Ugh... my head... Where am I?';
      let i = 0;
      const timer = setInterval(() => {
        i++;
        sub.textContent = text.slice(0, i);
        if (i >= text.length) clearInterval(timer);
      }, 60);
    });

    // And the game begins
    at(15400, () => {
      $('pov').classList.remove('show');
      sub.textContent = '';
    });
    at(16900, () => beginGame(true));
  }

  function skipIntro() {
    introTimers.forEach(clearTimeout);
    introTimers = [];
    introSkip = null;
    audio.stopDrone(0.5);
    $('white').classList.add('gone');
    $('pov').classList.remove('show');
    beginGame(false);
  }

  function beginGame(first) {
    introSkip = null;
    $('pov').style.display = 'none';
    $('white').classList.add('gone');
    playing = true;
    $('hud').classList.add('on');
    renderHud();
    audio.unlock(() => audio.ambient());
    document.addEventListener('pointerdown', () => audio.unlock(() => audio.ambient()), { once: true });
    later(10000, () => $('controls-hint').classList.add('fade'));
    if (first) {
      say([
        'A concrete room. A stained mattress. One narrow window. A steel door with no handle on this side.',
        { who: 'YOU', text: 'Okay. Okay. Think. There has to be a way out of here.' }
      ]);
    }
  }

  // =====================================================================
  //  Boot
  // =====================================================================
  requestAnimationFrame(frame);

  const saved = loadSave();
  if (saved) {
    $('resume-box').hidden = false;
    $('btn-continue').addEventListener('click', () => {
      adoptSave(saved);
      $('resume-box').hidden = true;
      $('white').classList.add('gone');
      beginGame(false);
    });
    $('btn-new').addEventListener('click', () => {
      $('resume-box').hidden = true;
      state = freshState();
      runIntro(true);
    });
  } else {
    runIntro(false);
  }
})();
