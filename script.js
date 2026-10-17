(() => {
  'use strict';

  // =====================================================================
  //  Things you will probably want to change
  // =====================================================================
  const START_URL = 'start.html';   // where the Start button leads
  const GAME_TITLE = '';            // put the game's name here to show it above the buttons
  const HOW_TO_PLAY = [             // placeholder text for the How To Play panel
    'Use your mouse or finger to interact with the world.',
    'Look closely. Details matter, and so does everything you read.',
    'Your choices change what happens next.',
    'Your progress is saved in your browser automatically.'
  ];
  const SETTINGS_KEY = 'ducks2_settings';

  // =====================================================================
  //  Helpers
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const scene = $('scene');
  const menu = $('menu');
  const flashEl = $('flash');

  // =====================================================================
  //  Settings (saved in the browser)
  // =====================================================================
  const settings = Object.assign(
    { sound: true, volume: 70, reduceFlicker: prefersReduced, skipIntro: false },
    (() => {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
    })()
  );

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
  }

  // =====================================================================
  //  Sound (made in the browser, no audio files)
  //  Browsers keep sound off until the page is clicked, so the intro is
  //  usually silent and the sound comes in after the first click or key press.
  // =====================================================================
  const audio = (() => {
    let ctx = null;
    let master = null;
    let ambientOn = false;
    let buzzGain = null;
    let noiseBuf = null;

    function ensure() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      updateVolume();
      return ctx;
    }

    function running() {
      return ctx && ctx.state === 'running' && settings.sound;
    }

    function updateVolume() {
      if (!master) return;
      master.gain.value = settings.sound ? (settings.volume / 100) * 0.9 : 0;
    }

    function noise() {
      if (noiseBuf) return noiseBuf;
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }

    // Starts the low room hum and the light buzz
    function startAmbient() {
      if (ambientOn || !ctx) return;
      ambientOn = true;

      const hum = ctx.createOscillator();
      const humGain = ctx.createGain();
      hum.type = 'sine';
      hum.frequency.value = 52;
      humGain.gain.value = 0.07;
      hum.connect(humGain);
      humGain.connect(master);
      hum.start();

      const buzz = ctx.createOscillator();
      const buzz2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      buzzGain = ctx.createGain();
      buzz.type = 'sawtooth';
      buzz.frequency.value = 100;
      buzz2.type = 'sawtooth';
      buzz2.frequency.value = 150.7;
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      buzzGain.gain.value = 0;
      buzz.connect(filter);
      buzz2.connect(filter);
      filter.connect(buzzGain);
      buzzGain.connect(master);
      buzz.start();
      buzz2.start();
    }

    function unlock() {
      const c = ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume().then(startAmbient);
      else startAmbient();
    }

    function setLight(state) {
      if (!buzzGain) return;
      const level = { off: 0, dim: 0.035, soft: 0.03, flash: 0.075 }[state] || 0;
      buzzGain.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
    }

    function tone(type, from, to, length, volume) {
      if (!running()) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length);
      g.gain.setValueAtTime(volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + length + 0.02);
    }

    function burstNoise(length, volume, filterType, freq, sweepTo) {
      if (!running()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + length);
      const g = ctx.createGain();
      g.gain.setValueAtTime(volume, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + length + 0.02);
    }

    return {
      unlock,
      updateVolume,
      setLight,
      tick: () => tone('square', 1300, 1100, 0.03, 0.12),
      click: () => { tone('sine', 140, 60, 0.18, 0.5); tone('square', 900, 700, 0.04, 0.15); },
      pop: () => tone('sine', 380, 90, 0.22, 0.5),
      thud: () => tone('sine', 90, 36, 0.4, 0.7),
      whoosh: () => burstNoise(0.9, 0.25, 'lowpass', 200, 3000),
      glitch: () => { [0, 90, 200].forEach(d => setTimeout(() => burstNoise(0.12, 0.3, 'bandpass', rnd(600, 4000)), d)); },
      burst: () => { burstNoise(0.6, 0.9, 'highpass', 900); tone('sine', 120, 40, 0.5, 0.8); }
    };
  })();

  // Browsers only allow sound after the first click or key press
  const unlockOnce = () => {
    audio.unlock();
    document.removeEventListener('pointerdown', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
  };
  document.addEventListener('pointerdown', unlockOnce);
  document.addEventListener('keydown', unlockOnce);

  // =====================================================================
  //  The flickering light
  // =====================================================================
  const light = (() => {
    let running = false;
    let timer = null;

    function set(state) {
      scene.dataset.light = state;
      document.body.dataset.light = state;
      audio.setLight(state);
    }

    function stop() {
      running = false;
      clearTimeout(timer);
    }

    // Plays a list of [state, milliseconds] steps, then calls done()
    function sequence(steps, done) {
      let i = 0;
      (function step() {
        if (i >= steps.length) { if (done) done(); return; }
        const [state, ms] = steps[i++];
        set(state);
        timer = setTimeout(step, ms);
      })();
    }

    function loop() {
      if (!running) return;
      scene.classList.toggle('rf', settings.reduceFlicker);

      let steps;
      const r = Math.random();

      if (settings.reduceFlicker) {
        steps = [['dim', 2800], ['soft', 2800]];
      } else if (r < 0.34) {
        steps = [['dim', rnd(1800, 4200)]];
      } else if (r < 0.62) {
        // A burst of stuttering
        steps = [];
        const n = Math.floor(rnd(3, 7));
        for (let i = 0; i < n; i++) steps.push([i % 2 ? 'dim' : 'off', rnd(35, 150)]);
        steps.push(['dim', rnd(500, 1200)]);
      } else if (r < 0.88) {
        // A flash of full light: you catch a glimpse of him
        steps = [['off', rnd(90, 200)], ['flash', rnd(70, 140)], ['off', 60], ['flash', rnd(350, 850)], ['dim', rnd(250, 500)]];
      } else {
        // A long blackout, then it comes back with a bang
        steps = [['off', rnd(800, 1600)], ['flash', 140], ['off', 90], ['flash', 520], ['dim', 600]];
      }

      sequence(steps, loop);
    }

    function start() {
      running = true;
      scene.classList.toggle('rf', settings.reduceFlicker);
      // The first time, the light struggles on
      const first = settings.reduceFlicker
        ? [['off', 600], ['soft', 1200]]
        : [['off', 500], ['flash', 80], ['off', 140], ['dim', 220], ['off', 110], ['flash', 420], ['dim', 700]];
      sequence(first, loop);
    }

    return { start, stop, set, sequence };
  })();

  // Specks of dust drifting in the light
  (function makeDust() {
    const box = $('dust');
    for (let i = 0; i < 22; i++) {
      const m = document.createElement('div');
      m.className = 'mote';
      m.style.left = rnd(30, 70) + '%';
      m.style.top = rnd(2, 70) + '%';
      m.style.animationDuration = rnd(7, 16) + 's';
      m.style.animationDelay = -rnd(0, 12) + 's';
      m.style.opacity = rnd(0.3, 0.9);
      box.appendChild(m);
    }
  })();

  // =====================================================================
  //  The logo intro
  // =====================================================================
  const intro = $('intro');
  let introTimers = [];
  let introDone = false;

  function at(ms, fn) { introTimers.push(setTimeout(fn, ms)); }

  function buildLogo() {
    // The swirl: a hand-wobbled spiral growing outward from the centre
    const cx = 120;
    const cy = 105;
    let d = '';
    for (let a = 0; a <= Math.PI * 4.3; a += 0.12) {
      const r = 5 + a * 6.2 + Math.sin(a * 3) * 1.4;
      const x = cx + Math.cos(a - 1.2) * r;
      const y = cy + Math.sin(a - 1.2) * r;
      d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    $('swirl').setAttribute('d', d);

    // Hide the strokes that draw themselves
    ['swirl', 'smile1', 'smile2', 'smile3'].forEach(id => {
      const p = $(id);
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
    });
  }

  function runIntro() {
    buildLogo();

    // Yellow swirl spins in and draws itself
    at(400, () => {
      audio.whoosh();
      $('swirl-g').classList.add('in');
      $('swirl').classList.add('draw');
    });

    // Red star slams down
    at(2100, () => {
      $('star-g').classList.add('slam');
      audio.thud();
    });

    // Blue face inflates, then its eyes pop and the smile scribbles on
    at(3000, () => {
      $('face-g').classList.add('inflate');
      audio.pop();
    });
    at(3700, () => { $('eye-big').classList.add('pop'); audio.tick(); });
    at(3920, () => { $('eye-small').classList.add('pop'); audio.tick(); });
    at(4150, () => {
      ['smile1', 'smile2', 'smile3'].forEach(id => $(id).classList.add('draw'));
    });

    // The company name glitches in
    at(5100, () => {
      $('logo-text').classList.add('glitch-in');
      audio.glitch();
    });
    at(6400, () => $('logo-text').classList.add('settled'));

    // The hint to skip, then the fade out
    at(1500, () => $('skip-hint').classList.add('show'));
    at(7700, () => intro.classList.add('fade'));
    at(8600, finishIntro);
  }

  function finishIntro() {
    if (introDone) return;
    introDone = true;
    introTimers.forEach(clearTimeout);
    introTimers = [];
    intro.classList.add('done');
    showTitle();
  }

  intro.addEventListener('click', finishIntro);
  document.addEventListener('keydown', (e) => {
    if (!introDone && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
      e.preventDefault();
      finishIntro();
    }
  });

  // =====================================================================
  //  The title screen
  // =====================================================================
  function showTitle() {
    document.body.classList.add('title');
    light.start();
    setTimeout(() => {
      menu.classList.add('show');
      $('btn-start').focus({ preventScroll: true });
    }, settings.skipIntro ? 600 : 1500);
  }

  // The optional game title above the buttons
  if (GAME_TITLE) {
    const h = $('game-title');
    h.textContent = GAME_TITLE;
    h.hidden = false;
  }

  // Button sounds
  document.querySelectorAll('.menu-btn').forEach(b => {
    b.addEventListener('mouseenter', () => audio.tick());
    b.addEventListener('focus', () => audio.tick());
  });

  // =====================================================================
  //  How To Play and Settings panels
  // =====================================================================
  const howPanel = $('panel-how');
  const setPanel = $('panel-settings');
  let openPanel = null;
  let openerBtn = null;

  $('how-list').innerHTML = '';
  HOW_TO_PLAY.forEach(line => {
    const li = document.createElement('li');
    li.textContent = line;
    $('how-list').appendChild(li);
  });

  function open(panel, opener) {
    audio.click();
    openPanel = panel;
    openerBtn = opener;
    panel.hidden = false;
    const first = panel.querySelector('input, button');
    if (first) first.focus();
  }

  function close() {
    if (!openPanel) return;
    openPanel.hidden = true;
    openPanel = null;
    if (openerBtn) openerBtn.focus();
  }

  $('btn-how').addEventListener('click', (e) => open(howPanel, e.currentTarget));
  $('btn-settings').addEventListener('click', (e) => open(setPanel, e.currentTarget));
  document.querySelectorAll('.panel-close').forEach(b => b.addEventListener('click', close));

  // Clicking the dark area outside the box closes the panel
  [howPanel, setPanel].forEach(p => p.addEventListener('click', (e) => { if (e.target === p) close(); }));

  document.addEventListener('keydown', (e) => {
    if (!openPanel) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      // Keep Tab inside the panel
      const items = Array.from(openPanel.querySelectorAll('input, button'));
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Settings controls
  const setSound = $('set-sound');
  const setVolume = $('set-volume');
  const setFlicker = $('set-flicker');
  const setIntro = $('set-intro');

  setSound.checked = settings.sound;
  setVolume.value = settings.volume;
  setFlicker.checked = settings.reduceFlicker;
  setIntro.checked = settings.skipIntro;

  setSound.addEventListener('change', () => {
    settings.sound = setSound.checked;
    audio.updateVolume();
    saveSettings();
  });
  setVolume.addEventListener('input', () => {
    settings.volume = Number(setVolume.value);
    audio.updateVolume();
    saveSettings();
  });
  setFlicker.addEventListener('change', () => {
    settings.reduceFlicker = setFlicker.checked;
    scene.classList.toggle('rf', settings.reduceFlicker);
    saveSettings();
  });
  setIntro.addEventListener('change', () => {
    settings.skipIntro = setIntro.checked;
    saveSettings();
  });

  // =====================================================================
  //  The Start animation
  //  The light panics, the bulb bursts, and in the dark the guy opens his eyes.
  // =====================================================================
  let starting = false;

  function startGame() {
    if (starting) return;
    starting = true;

    audio.unlock();
    audio.click();
    menu.classList.add('leaving');
    light.stop();

    // Gentle version for reduced motion / reduce flicker: fade to white, no strobing
    if (settings.reduceFlicker || prefersReduced) {
      scene.classList.add('rf');
      light.set('off');
      setTimeout(() => flashEl.classList.add('on'), 900);
      setTimeout(() => { window.location.href = START_URL; }, 2200);
      return;
    }

    // Where things are on screen right now (before we zoom)
    const head = document.getElementById('guy-head').getBoundingClientRect();
    const bulb = document.getElementById('bulb-glass').getBoundingClientRect();
    const headX = head.left + head.width / 2;
    const headY = head.top + head.height / 2;

    // The light panics
    light.sequence([
      ['flash', 90], ['off', 60], ['dim', 50], ['off', 90], ['flash', 80],
      ['off', 50], ['flash', 70], ['off', 40], ['dim', 60], ['flash', 90], ['off', 60], ['flash', 80]
    ]);

    // The camera creeps toward him
    scene.style.transformOrigin = `${headX}px ${headY}px`;
    scene.style.transition = 'transform 2.8s cubic-bezier(0.6, 0, 0.3, 1)';
    requestAnimationFrame(() => { scene.style.transform = 'scale(2.8)'; });

    // 1.0s: the bulb bursts
    setTimeout(() => {
      const box = $('sparks');
      const bx = bulb.left + bulb.width / 2;
      const by = bulb.top + bulb.height / 2;
      for (let i = 0; i < 16; i++) {
        const s = document.createElement('div');
        s.className = 'spark';
        s.style.left = bx + 'px';
        s.style.top = by + 'px';
        s.style.setProperty('--dx', rnd(-140, 140) + 'px');
        s.style.setProperty('--dy', rnd(-60, 200) + 'px');
        box.appendChild(s);
      }
      flashEl.className = 'burst';
      setTimeout(() => { flashEl.className = 'fade'; }, 60);
      light.set('off');
      audio.burst();
    }, 1000);

    // 2.7s: in the dark, two eyes appear where his head is
    setTimeout(() => {
      const h = document.getElementById('guy-head').getBoundingClientRect();
      const cx = h.left + h.width / 2;
      const cy = h.top + h.height * 0.5;
      const w = Math.max(14, h.width * 0.14);
      const gap = h.width * 0.2;
      const eyeL = $('eye-l');
      const eyeR = $('eye-r');
      [[eyeL, -gap], [eyeR, gap]].forEach(([el, dx]) => {
        el.style.width = w + 'px';
        el.style.height = w * 0.8 + 'px';
        el.style.left = (cx + dx - w / 2) + 'px';
        el.style.top = (cy - w * 0.4) + 'px';
      });
      const eyes = $('eyes');
      eyes.classList.add('show', 'slit');
    }, 2700);

    // 3.2s: they snap open
    setTimeout(() => {
      const eyes = $('eyes');
      eyes.classList.remove('slit');
      eyes.classList.add('open');
      audio.thud();
    }, 3300);

    // 4.4s: white out, then on to the game
    setTimeout(() => { flashEl.className = 'on'; }, 4400);
    setTimeout(() => { window.location.href = START_URL; }, 5000);
  }

  $('btn-start').addEventListener('click', startGame);

  // =====================================================================
  //  Go
  // =====================================================================
  if (settings.skipIntro) {
    introDone = true;
    intro.classList.add('done');
    showTitle();
  } else {
    runIntro();
  }
})();
