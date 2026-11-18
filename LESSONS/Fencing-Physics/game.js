// Chalk Duel: drawing, sound, menus, keyboard and round rules. The physics live in sim.js.
'use strict';
(() => {
  const H = 540, WINS = 3, ROUND_SECONDS = 60;
  const COLORS = ['#efece2', '#e9c46a'], BOARD = '#26332e', FONT = "'Atkinson Hyperlegible','Segoe UI',system-ui,sans-serif";
  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d', { alpha: false });
  const $ = id => document.getElementById(id);
  const overlay = $('overlay'), panels = { menu: $('menu'), paused: $('paused'), ended: $('ended') };

  // ---------- static layers ----------
  function layer() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
  const boardLayer = layer(), dustLayer = layer(), dustCtx = dustLayer.getContext('2d');
  (function paintBoard() {
    const b = boardLayer.getContext('2d');
    b.fillStyle = BOARD; b.fillRect(0, 0, W, H);
    b.lineCap = 'round';
    for (let i = 0; i < 14; i++) { // old erased marks
      b.strokeStyle = 'rgba(239,236,226,.011)'; b.lineWidth = 26 + Math.random() * 34;
      const x = Math.random() * W, y = Math.random() * GROUND;
      b.beginPath(); b.moveTo(x, y); b.lineTo(x + 90 + Math.random() * 190, y + (Math.random() - .5) * 46); b.stroke();
    }
    b.fillStyle = 'rgba(239,236,226,.05)';
    for (let i = 0; i < 1500; i++) b.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
    b.font = `26px ${FONT}`; b.fillStyle = 'rgba(239,236,226,.07)';
    b.fillText('p = mv', 96, 150); b.fillText('F = ma', 760, 196); b.fillText('KE = ½mv²', 408, 128);
    b.strokeStyle = 'rgba(239,236,226,.8)'; b.lineWidth = 3;
    b.beginPath(); b.moveTo(0, GROUND + 3);
    for (let x = 24; x <= W + 24; x += 24) b.lineTo(x, GROUND + 3 + Math.random() * 1.6 - .8);
    b.stroke();
    b.strokeStyle = 'rgba(239,236,226,.12)'; b.lineWidth = 2;
    for (let x = -30; x < W; x += 38) { b.beginPath(); b.moveTo(x + 22, GROUND + 10); b.lineTo(x, GROUND + 40); b.stroke(); }
    b.fillStyle = '#4d3c2b'; b.fillRect(0, H - 20, W, 20);
    b.fillStyle = '#3c2f22'; b.fillRect(0, H - 20, W, 3);
    b.fillStyle = '#efece2'; b.fillRect(824, H - 26, 54, 7);
    b.fillStyle = '#e9c46a'; b.fillRect(890, H - 26, 34, 7);
  })();

  // ---------- sound ----------
  let audio = null, muted = false;
  function burst(freq, len, vol, type) {
    if (!audio || muted) return;
    const t = audio.currentTime, g = audio.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + len); g.connect(audio.destination);
    if (type === 'noise') {
      const size = Math.floor(audio.sampleRate * len), buf = audio.createBuffer(1, size, audio.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
      const src = audio.createBufferSource(), f = audio.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = freq; src.buffer = buf; src.connect(f); f.connect(g); src.start(t);
    } else {
      const o = audio.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(g); o.start(t); o.stop(t + len);
    }
  }

  // ---------- game state ----------
  let solo = true, level = 'normal', world = null, score = [0, 0], round = 0;
  let phase = 'idle', phaseT = 0, timer = ROUND_SECONDS, banner = '', slow = 0, shake = 0;
  let playing = false, acc = 0, last = performance.now();
  const dust = [], trails = [[], []];

  function show(name) {
    overlay.hidden = !name;
    for (const k in panels) panels[k].hidden = k !== name;
    canvas.style.cursor = !name && solo ? 'crosshair' : 'default';
    if (name) { const b = panels[name].querySelector('button'); if (b) b.focus({ preventScroll: true }); }
  }
  function startMatch(isSolo, lvl) {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } }
    if (audio && audio.state === 'suspended') audio.resume();
    solo = isSolo; level = lvl; score = [0, 0]; round = 0; mouseAim = isSolo;
    nextRound(); playing = true; show(null); window.focus();
  }
  function nextRound() {
    round++; world = makeWorld(); phase = 'ready'; phaseT = 1.5; timer = ROUND_SECONDS;
    banner = `Round ${round}`; dust.length = 0; trails[0].length = trails[1].length = 0;
    dustCtx.clearRect(0, 0, W, H);
  }
  function endRound() {
    const { a, b } = world;
    const win = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1;
    if (win >= 0) score[win]++;
    banner = win < 0 ? 'Even round' : `${nameOf(win)} takes the round`;
    phase = 'over'; phaseT = 2.1;
    if (a.hp <= 0 || b.hp <= 0) slow = .75;
  }
  const nameOf = i => (i === 0 ? 'Player 1' : solo ? 'Computer' : 'Player 2');
  function pause() { if (playing && phase !== 'idle') { playing = false; keys.clear(); mouseDown = false; show('paused'); } }

  // ---------- input ----------
  const keys = new Set();
  const SCHEMES = [
    { l: 'KeyA', r: 'KeyD', hop: 'KeyW', duck: 'KeyS', up: 'KeyF', down: 'KeyG', thrust: 'KeyH' },
    { l: 'ArrowLeft', r: 'ArrowRight', hop: 'ArrowUp', duck: 'ArrowDown', up: 'KeyK', down: 'KeyL', thrust: 'Semicolon' },
  ];
  const GAME_KEYS = new Set(SCHEMES.flatMap(s => Object.values(s)));
  let mouseAim = false, mouseDown = false, mouseX = 0, mouseY = 0;

  addEventListener('keydown', e => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (playing) pause(); else if (!panels.paused.hidden) resume();
      return;
    }
    if (e.code === 'KeyM') muted = !muted;
    if (!playing) return;
    if (GAME_KEYS.has(e.code)) { e.preventDefault(); keys.add(e.code); }
    if (e.code === 'KeyF' || e.code === 'KeyG') mouseAim = false;
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', pause);
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouseX = (e.clientX - r.left) / r.width * W; mouseY = (e.clientY - r.top) / r.height * H;
    if (solo) mouseAim = true;
  });
  canvas.addEventListener('pointerdown', () => { if (solo) mouseDown = true; });
  addEventListener('pointerup', () => { mouseDown = false; });

  function readPlayer(f, i) {
    const s = SCHEMES[i], inp = f.in;
    inp.mx = (keys.has(s.r) ? 1 : 0) - (keys.has(s.l) ? 1 : 0);
    inp.hop = keys.has(s.hop); inp.duck = keys.has(s.duck);
    inp.up = keys.has(s.up); inp.down = keys.has(s.down);
    inp.thrust = keys.has(s.thrust) || (solo && mouseDown);
    inp.aimTo = null;
    if (solo && mouseAim) {
      let a = Math.atan2(f.p.neck.y - mouseY, (mouseX - f.p.neck.x) * f.f);
      if (a < -2.2) a += Math.PI * 2; // pointing behind the back means over the shoulder
      inp.aimTo = a;
    }
  }

  // ---------- one physics step ----------
  function tick() {
    const { a, b } = world;
    if (phase === 'fight') {
      readPlayer(a, 0);
      if (solo) botThink(b, a, level, Math.random); else readPlayer(b, 1);
    } else { a.in = blankInput(); b.in = blankInput(); }
    stepWorld(world);
    for (const e of world.events) onEvent(e);
    world.events.length = 0;

    phaseT -= DT;
    if (phase === 'ready' && phaseT <= 0) { phase = 'fight'; banner = 'Go'; phaseT = .6; }
    else if (phase === 'fight') {
      if (phaseT <= 0) banner = '';
      timer -= DT;
      if (a.hp <= 0 || b.hp <= 0 || timer <= 0) endRound();
    } else if (phase === 'over' && phaseT <= 0) {
      if (Math.max(score[0], score[1]) >= WINS) finishMatch(); else nextRound();
    }
  }
  function finishMatch() {
    playing = false; phase = 'idle';
    $('end-title').textContent = `${nameOf(score[0] > score[1] ? 0 : 1)} wins`;
    $('end-score').textContent = `Final score ${score[0]} to ${score[1]}.`;
    show('ended');
  }
  function onEvent(e) {
    if (e.type === 'hit') {
      puff(e.x, e.y, 7 + e.dmg * 1.1, 'rgba(239,236,226,.85)');
      dustCtx.fillStyle = 'rgba(239,236,226,.09)';
      for (let i = 0; i < 9; i++) dustCtx.fillRect(e.x + (Math.random() - .5) * e.dmg * 3, e.y + (Math.random() - .5) * e.dmg * 3, 3, 3);
      shake = Math.max(shake, Math.min(7, e.dmg * .35));
      burst(170 + e.dmg * 8, .16, .34, 'noise');
    } else {
      puff(e.x, e.y, 6, 'rgba(233,196,106,.95)');
      burst(1250 + Math.random() * 500, .09, .1, 'triangle'); burst(2300, .05, .04, 'square');
    }
  }
  function puff(x, y, n, color) {
    for (let i = 0; i < n && dust.length < 110; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 190;
      dust.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: .3 + Math.random() * .4, size: 1.5 + Math.random() * 2.5, color });
    }
  }

  // ---------- drawing ----------
  let boilA = [0, 0], boilB = [0, 0], boilAt = 0;
  const seg = (a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };

  function chalkStroke(width, color, alpha, dashed) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dashed ? [7, 7] : []);
    ctx.globalAlpha = alpha; ctx.save(); ctx.translate(boilA[0], boilA[1]); ctx.stroke(); ctx.restore();
    ctx.globalAlpha = alpha * .35; ctx.save(); ctx.translate(boilB[0], boilB[1]); ctx.stroke(); ctx.restore();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function drawFighter(f, i) {
    const P = f.p, col = COLORS[i], alpha = .62 + .38 * f.hp / 100;
    const dx = P.tip.x - P.hand.x, dy = P.tip.y - P.hand.y, ux = dx / LEN.blade, uy = dy / LEN.blade;

    const trail = trails[i], speed = Math.hypot(P.tip.x - P.tip.px, P.tip.y - P.tip.py) / DT;
    trail.push(P.tip.x, P.tip.y); if (trail.length > 16) trail.splice(0, 2);
    if (speed > 330) {
      ctx.beginPath(); ctx.moveTo(trail[0], trail[1]);
      for (let t = 2; t < trail.length; t += 2) ctx.lineTo(trail[t], trail[t + 1]);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = Math.min(.42, (speed - 330) / 1100); ctx.stroke(); ctx.globalAlpha = 1;
    }

    ctx.beginPath(); seg(P.pelvis, P.neck); seg(P.neck, P.head);
    ctx.moveTo(P.head.x + 14, P.head.y); ctx.arc(P.head.x, P.head.y, 14, 0, Math.PI * 2);
    chalkStroke(5, col, alpha);

    ctx.beginPath(); seg(P.pelvis, P.kneeA); seg(P.kneeA, P.footA); seg(P.pelvis, P.kneeB); seg(P.kneeB, P.footB);
    chalkStroke(5, col, alpha, f.leg < .75);

    ctx.beginPath(); seg(P.neck, P.elbow); seg(P.elbow, P.hand);
    if (f.bal > .25) { // second hand on the grip
      const gx = P.hand.x + ux * 11, gy = P.hand.y + uy * 11;
      ctx.moveTo(P.neck.x, P.neck.y); ctx.lineTo((P.neck.x + gx) / 2 - f.f * 3, (P.neck.y + gy) / 2 + 13); ctx.lineTo(gx, gy);
    }
    chalkStroke(4.5, col, alpha, f.arm < .75);

    ctx.beginPath(); ctx.moveTo(P.hand.x - ux * 12, P.hand.y - uy * 12); ctx.lineTo(P.hand.x + ux * 14, P.hand.y + uy * 14);
    ctx.moveTo(P.hand.x + ux * 14 - uy * 10, P.hand.y + uy * 14 + ux * 10); ctx.lineTo(P.hand.x + ux * 14 + uy * 10, P.hand.y + uy * 14 - ux * 10);
    chalkStroke(4, col, 1);
    ctx.beginPath(); ctx.moveTo(P.hand.x + ux * 14, P.hand.y + uy * 14); ctx.lineTo(P.tip.x, P.tip.y);
    chalkStroke(2.6, '#f8f6ef', 1);
  }

  function drawHud() {
    const { a, b } = world, barW = 330;
    [a, b].forEach((f, i) => {
      const x = i ? W - 36 - barW : 36, frac = f.hp / 100, col = COLORS[i];
      ctx.font = `700 15px ${FONT}`; ctx.fillStyle = col; ctx.textAlign = i ? 'right' : 'left';
      ctx.fillText(i && solo ? `Computer (${level})` : nameOf(i), i ? x + barW : x, 25);
      ctx.fillStyle = 'rgba(239,236,226,.08)'; ctx.fillRect(x, 32, barW, 13);
      ctx.fillStyle = col; ctx.globalAlpha = .9;
      ctx.fillRect(i ? x + barW * (1 - frac) : x, 32, barW * frac, 13); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(239,236,226,.65)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, 32, barW, 13);
      for (let p = 0; p < WINS; p++) {
        const px = i ? x + barW - 8 - p * 21 : x + 8 + p * 21;
        ctx.beginPath(); ctx.arc(px, 59, 6, 0, Math.PI * 2);
        if (p < score[i]) { ctx.fillStyle = col; ctx.fill(); } else { ctx.strokeStyle = 'rgba(239,236,226,.5)'; ctx.stroke(); }
      }
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#efece2'; ctx.font = `700 30px ${FONT}`;
    ctx.fillText(String(Math.max(0, Math.ceil(timer))), W / 2, 48);
    if (banner) {
      ctx.font = `700 46px ${FONT}`; ctx.lineWidth = 7; ctx.strokeStyle = BOARD; ctx.lineJoin = 'round';
      ctx.strokeText(banner, W / 2, 196); ctx.fillText(banner, W / 2, 196);
    }
    ctx.textAlign = 'left';
  }

  function draw(now, dt) {
    if (now - boilAt > 110) { // chalk lines shimmer a few times a second, like hand-drawn animation
      boilAt = now;
      boilA = [(Math.random() - .5) * 1, (Math.random() - .5) * 1];
      boilB = [(Math.random() - .5) * 3, (Math.random() - .5) * 3];
    }
    shake = Math.max(0, shake - dt * 26);
    ctx.drawImage(boardLayer, 0, 0, W, H);
    if (!world) return;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    ctx.drawImage(dustLayer, 0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    drawFighter(world.a, 0); drawFighter(world.b, 1);
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i]; d.life -= dt;
      if (d.life <= 0) { dust.splice(i, 1); continue; }
      d.vy += 420 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      ctx.globalAlpha = Math.min(1, d.life * 3); ctx.fillStyle = d.color; ctx.fillRect(d.x, d.y, d.size, d.size);
    }
    ctx.globalAlpha = 1; ctx.restore();
    drawHud();
  }

  function fit() {
    const scale = Math.min(innerWidth / W, innerHeight / H), dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.style.width = `${Math.floor(W * scale)}px`; canvas.style.height = `${Math.floor(H * scale)}px`;
    canvas.width = Math.floor(W * scale * dpr); canvas.height = Math.floor(H * scale * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  addEventListener('resize', fit); fit();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (playing) {
      if (slow > 0) slow -= dt;
      acc += dt * (slow > 0 ? .35 : 1);
      let steps = 0;
      while (acc >= DT && steps < 8 && playing) { tick(); acc -= DT; steps++; }
      if (steps === 8) acc = 0; // slow machine: let the game run slower rather than freeze
    }
    draw(now, playing ? dt : 0);
  }
  requestAnimationFrame(frame);

  // ---------- menus ----------
  function resume() { playing = true; last = performance.now(); show(null); window.focus(); }
  document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => startMatch(true, b.dataset.level)));
  $('two').addEventListener('click', () => startMatch(false, level));
  $('resume').addEventListener('click', resume);
  $('again').addEventListener('click', () => startMatch(solo, level));
  document.querySelectorAll('.to-menu').forEach(b => b.addEventListener('click', () => { playing = false; phase = 'idle'; world = null; show('menu'); }));
  show('menu');
})();
