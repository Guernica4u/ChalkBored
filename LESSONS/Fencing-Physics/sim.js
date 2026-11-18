// Chalk Duel: the physics and the computer player. No drawing in here, so it can be tested on its own.
'use strict';

const W = 960, GROUND = 462, DT = 1 / 120, GRAVITY = 1500;
const LEN = { torso: 50, neck: 22, thigh: 35, shin: 35, upper: 27, fore: 27, blade: 88 };
const AIM_MIN = -1.7, AIM_MAX = 2.8;
const MAX_STEP = 1500 * DT;
const HIT_SPEED = 170; // slower contact only pushes, so a resting blade does nothing

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const vx = p => (p.x - p.px) / DT;
const vy = p => (p.y - p.py) / DT;
const kick = (p, x, y) => { p.px -= x * DT; p.py -= y * DT; };

// Moves a point without giving it speed; a plain move would count as velocity and launch bodies.
const shove = (p, x, y) => { p.x += x; p.y += y; p.px += x; p.py += y; };

function point(x, y, mass) { return { x, y, px: x, py: y, w: 1 / mass, ax: 0, ay: 0 }; }

function pull(p, tx, ty, k, c) {
  p.ax += k * (tx - p.x) - c * vx(p);
  p.ay += k * (ty - p.y) - c * vy(p);
}

function makeFighter(x, facing) {
  const py = GROUND - 60;
  const p = {
    pelvis: point(x, py, 3), neck: point(x, py - LEN.torso, 3), head: point(x, py - LEN.torso - LEN.neck, 1.6),
    kneeA: point(x + 8, py + 30, 1), footA: point(x + 14, GROUND, 1),
    kneeB: point(x - 8, py + 30, 1), footB: point(x - 14, GROUND, 1),
    elbow: point(x + facing * 20, py - 36, 1), hand: point(x + facing * 38, py - 50, 1.2),
    tip: point(x + facing * 110, py - 90, 1.1),
  };
  return {
    p, pts: Object.values(p), f: facing, anchor: x, hp: 100, arm: 1, leg: 1, bal: 1, downT: 0,
    aim: 0.7, aimV: 0, thr: 0, phase: 0, hopCd: 0, lungeCd: 0, hitCd: 0, swingMul: 1, wasThrust: false,
    in: blankInput(), ai: null,
    bones: [
      [p.pelvis, p.neck, LEN.torso], [p.neck, p.head, LEN.neck],
      [p.pelvis, p.kneeA, LEN.thigh], [p.kneeA, p.footA, LEN.shin],
      [p.pelvis, p.kneeB, LEN.thigh], [p.kneeB, p.footB, LEN.shin],
      [p.neck, p.elbow, LEN.upper], [p.elbow, p.hand, LEN.fore], [p.hand, p.tip, LEN.blade],
    ],
    parts: [
      [p.head, p.head, 15, 'head'], [p.neck, p.pelvis, 11, 'torso'],
      [p.pelvis, p.kneeA, 6, 'leg'], [p.kneeA, p.footA, 5, 'leg'],
      [p.pelvis, p.kneeB, 6, 'leg'], [p.kneeB, p.footB, 5, 'leg'],
      [p.neck, p.elbow, 5, 'arm'], [p.elbow, p.hand, 5, 'arm'],
    ],
  };
}

function blankInput() { return { mx: 0, hop: false, duck: false, up: false, down: false, thrust: false, aimTo: null }; }

function control(f, o) {
  const P = f.p;
  if (f.hp <= 0) f.bal = Math.max(0, f.bal - DT * 10);
  else if (f.downT > 0) { f.downT -= DT; f.bal = Math.max(0, f.bal - DT * 8); }
  else f.bal = Math.min(1, f.bal + DT * 1.6);
  f.hopCd -= DT; f.lungeCd -= DT; f.hitCd -= DT;
  const b = f.bal, inp = f.in;

  if (f.hp > 0 && b > 0.5 && Math.abs(o.p.pelvis.x - P.pelvis.x) > 18) f.f = Math.sign(o.p.pelvis.x - P.pelvis.x);

  const grounded = Math.max(P.footA.y, P.footB.y) >= GROUND - 4;
  const speed = vx(P.pelvis);
  let target = inp.mx * 215 * (0.55 + 0.45 * f.leg) * (inp.duck ? 0.6 : 1);
  if (inp.mx && inp.mx !== f.f) target *= 0.78;
  if (grounded) P.pelvis.ax += (target - speed) * 14 * b;
  // Standing still: hold the spot, otherwise the leaning body slowly creeps forward.
  if (inp.mx || b < 0.9 || !grounded || Math.abs(speed) > 60) f.anchor = P.pelvis.x;
  else P.pelvis.ax += 160 * (f.anchor - P.pelvis.x) * b;

  if (grounded) {
    const y = GROUND - (inp.duck ? 42 : 60);
    P.pelvis.ay += (900 * (y - P.pelvis.y) - 45 * vy(P.pelvis) - GRAVITY) * b;
  }
  if (inp.hop && grounded && f.hopCd <= 0 && b > 0.6) {
    f.hopCd = 0.55;
    for (const q of f.pts) kick(q, 0, -(430 * (0.7 + 0.3 * f.leg)));
  }

  const lean = f.f * (6 + f.thr * 14) + speed * 0.03;
  pull(P.neck, P.pelvis.x + lean, P.pelvis.y - LEN.torso, 1100 * b, 45 * b); P.neck.ay -= GRAVITY * b;
  pull(P.head, P.neck.x + f.f * 3, P.neck.y - LEN.neck, 900 * b, 35 * b); P.head.ay -= GRAVITY * b;

  if (grounded) f.phase += speed * DT / 26;
  const move = Math.min(1, Math.abs(speed) / 70);
  [[P.footA, P.kneeA, 0, 15], [P.footB, P.kneeB, Math.PI, -13]].forEach(([foot, knee, off, base]) => {
    const ph = f.phase + off;
    const tx = P.pelvis.x + f.f * base + Math.sin(ph) * 24 * move;
    const ty = grounded ? GROUND - Math.max(0, Math.cos(ph)) * 12 * move : P.pelvis.y + 58;
    pull(foot, tx, ty, 1400 * b, 50 * b);
    pull(knee, (P.pelvis.x + foot.x) / 2 + f.f * 13, (P.pelvis.y + foot.y) / 2, 500 * b, 20 * b);
  });

  // The blade is aimed by turning a target; how fast it really moves comes from its weight.
  const armF = 0.55 + 0.45 * f.arm, maxV = 9.5 * armF * f.swingMul;
  const want = inp.aimTo !== null ? clamp((inp.aimTo - f.aim) * 16, -maxV, maxV) : ((inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * maxV;
  f.aimV += clamp(want - f.aimV, -70 * DT, 70 * DT);
  f.aim += f.aimV * DT;
  if (f.aim < AIM_MIN || f.aim > AIM_MAX) { f.aim = clamp(f.aim, AIM_MIN, AIM_MAX); f.aimV = 0; }

  f.thr = inp.thrust ? Math.min(1, f.thr + DT * 14) : Math.max(0, f.thr - DT * 7);
  if (inp.thrust && !f.wasThrust && f.lungeCd <= 0 && grounded && b > 0.6) {
    f.lungeCd = 0.7; kick(P.pelvis, f.f * 170, 0); kick(P.neck, f.f * 170, 0);
  }
  f.wasThrust = inp.thrust;

  const ha = f.aim * 0.72 - 0.25, reach = 38 + 16 * f.thr;
  pull(P.hand, P.neck.x + f.f * Math.cos(ha) * reach, P.neck.y + 4 - Math.sin(ha) * reach, 1600 * b * armF, 45 * b);
  P.hand.ay -= GRAVITY * b * 0.9;
  pull(P.elbow, (P.neck.x + P.hand.x) / 2 - f.f * 4, (P.neck.y + P.hand.y) / 2 + 12, 300 * b, 14 * b);
  const sa = (f.aim + 0.15) * (1 - f.thr) + ha * f.thr;
  pull(P.tip, P.hand.x + f.f * Math.cos(sa) * LEN.blade, P.hand.y - Math.sin(sa) * LEN.blade, 900 * b * armF, 12 * b);
  P.tip.ay -= GRAVITY * b * 0.9;

  // In the air there is nothing to push against: muscles may bend the body but never lift it.
  if (!grounded) {
    let fx = 0, fy = 0, m = 0;
    for (const q of f.pts) { fx += q.ax / q.w; fy += q.ay / q.w; m += 1 / q.w; }
    const steer = (target - speed) * 2.5 * b;
    for (const q of f.pts) { q.ax += steer - fx / m; q.ay -= fy / m; }
  }
}

function integrate(f) {
  for (const p of f.pts) {
    // speed limit: stacked hits in one step must not fling a limb off the board
    const nx = p.x + clamp((p.x - p.px) * 0.999, -MAX_STEP, MAX_STEP) + p.ax * DT * DT;
    const ny = p.y + clamp((p.y - p.py) * 0.999, -MAX_STEP, MAX_STEP) + (p.ay + GRAVITY) * DT * DT;
    p.px = p.x; p.py = p.y; p.x = nx; p.y = ny; p.ax = 0; p.ay = 0;
  }
}

function solve(f) {
  for (const [a, b, len] of f.bones) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
    const m = (d - len) / d / (a.w + b.w);
    a.x += dx * m * a.w; a.y += dy * m * a.w;
    b.x -= dx * m * b.w; b.y -= dy * m * b.w;
  }
  for (const p of f.pts) {
    if (p.y > GROUND) { p.y = GROUND; p.px += (p.x - p.px) * 0.5; }
    p.x = clamp(p.x, 14, W - 14);
  }
}

// Closest points between segments ab and cd; written to `near` so the hot loop makes no garbage.
const near = { s: 0, t: 0, d: 0, nx: 0, ny: 0, x: 0, y: 0 };
function closest(a, b, c, d) {
  const ux = b.x - a.x, uy = b.y - a.y, vx2 = d.x - c.x, vy2 = d.y - c.y, wx = a.x - c.x, wy = a.y - c.y;
  const A = ux * ux + uy * uy, E = vx2 * vx2 + vy2 * vy2, F = vx2 * wx + vy2 * wy;
  let s, t;
  if (E < 1e-9) { t = 0; s = clamp(-(ux * wx + uy * wy) / A, 0, 1); }
  else {
    const C = ux * wx + uy * wy, B = ux * vx2 + uy * vy2, den = A * E - B * B;
    s = den > 1e-9 ? clamp((B * F - C * E) / den, 0, 1) : 0;
    t = (B * s + F) / E;
    if (t < 0) { t = 0; s = clamp(-C / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((B - C) / A, 0, 1); }
  }
  const px = a.x + ux * s, py = a.y + uy * s, qx = c.x + vx2 * t, qy = c.y + vy2 * t;
  const dx = qx - px, dy = qy - py, dist = Math.hypot(dx, dy) || 1e-6;
  near.s = s; near.t = t; near.d = dist; near.nx = dx / dist; near.ny = dy / dist; near.x = px; near.y = py;
}

function bladeHitsBody(A, D, events) {
  const hand = A.p.hand, tip = A.p.tip;
  for (const [c, d, r, part] of D.parts) {
    closest(hand, tip, c, d);
    if (near.d >= r) continue;
    const { s, t, nx, ny, x, y } = near, pen = r - near.d;
    const relX = vx(hand) * (1 - s) + vx(tip) * s - vx(c) * (1 - t) - vx(d) * t;
    const relY = vy(hand) * (1 - s) + vy(tip) * s - vy(c) * (1 - t) - vy(d) * t;
    const closing = relX * nx + relY * ny;

    shove(hand, -nx * pen * 0.7 * (1 - s), -ny * pen * 0.7 * (1 - s));
    shove(tip, -nx * pen * 0.7 * s, -ny * pen * 0.7 * s);
    shove(c, nx * pen * 0.3, ny * pen * 0.3);
    if (d !== c) shove(d, nx * pen * 0.3, ny * pen * 0.3);

    if (closing > HIT_SPEED && A.hitCd <= 0 && A.bal > 0.3 && D.hp > 0) {
      A.hitCd = 0.28;
      const mult = { head: 1.4, torso: 1, arm: 0.6, leg: 0.6 }[part];
      const dmg = clamp((closing - HIT_SPEED) / 48, 2, 24) * mult * (0.7 + 0.3 * A.arm);
      D.hp = Math.max(0, D.hp - dmg);
      if (part === 'arm') D.arm = Math.max(0.35, D.arm - dmg / 40);
      if (part === 'leg') D.leg = Math.max(0.35, D.leg - dmg / 40);
      if (dmg >= 15 || (part === 'head' && dmg >= 11)) D.downT = 0.6 + dmg / 60;
      const push = closing * 0.35;
      kick(c, nx * push, ny * push); if (d !== c) kick(d, nx * push, ny * push);
      kick(D.p.pelvis, nx * closing * 0.12, ny * closing * 0.06); kick(D.p.neck, nx * closing * 0.16, ny * closing * 0.06);
      kick(hand, -nx * closing * 0.4, -ny * closing * 0.4); kick(tip, -nx * closing * 0.75, -ny * closing * 0.75);
      A.aimV *= -0.25;
      events.push({ type: 'hit', x, y, dmg, part, ko: D.hp <= 0 });
    }
    return;
  }
}

function bladesClash(a, b, world, events) {
  const A1 = a.p.hand, A2 = a.p.tip, B1 = b.p.hand, B2 = b.p.tip;
  closest(A1, A2, B1, B2);
  if (near.d >= 7) return;
  const { s, t, nx, ny, x, y } = near, pen = (7 - near.d) / 2;
  shove(A1, -nx * pen * (1 - s), -ny * pen * (1 - s)); shove(A2, -nx * pen * s, -ny * pen * s);
  shove(B1, nx * pen * (1 - t), ny * pen * (1 - t)); shove(B2, nx * pen * t, ny * pen * t);
  const closing = (vx(A1) * (1 - s) + vx(A2) * s - vx(B1) * (1 - t) - vx(B2) * t) * nx
                + (vy(A1) * (1 - s) + vy(A2) * s - vy(B1) * (1 - t) - vy(B2) * t) * ny;
  if (closing <= 40) return;
  const j = closing * 0.75;
  kick(A1, -nx * j * (1 - s), -ny * j * (1 - s)); kick(A2, -nx * j * s, -ny * j * s);
  kick(B1, nx * j * (1 - t), ny * j * (1 - t)); kick(B2, nx * j * t, ny * j * t);
  a.aimV *= -0.3; b.aimV *= -0.3;
  if (closing > 160 && world.clashCd <= 0) { world.clashCd = 0.1; events.push({ type: 'clash', x, y, power: closing }); }
}

function bodiesPush(a, b) {
  for (const key of ['pelvis', 'neck']) {
    const p = a.p[key], q = b.p[key], dx = q.x - p.x;
    if (Math.abs(dx) < 26 && Math.abs(q.y - p.y) < 50) {
      const m = (26 - Math.abs(dx)) / 2 * (dx < 0 ? -1 : 1);
      shove(p, -m, 0); shove(q, m, 0);
    }
  }
}

function makeWorld() { return { a: makeFighter(290, 1), b: makeFighter(670, -1), clashCd: 0, events: [] }; }

function stepWorld(w) {
  const { a, b, events } = w;
  w.clashCd -= DT;
  control(a, b); control(b, a);
  integrate(a); integrate(b);
  for (let i = 0; i < 6; i++) { solve(a); solve(b); }
  bladesClash(a, b, w, events);
  // take turns going first, so neither side wins every tie
  w.flip = !w.flip;
  if (w.flip) { bladeHitsBody(a, b, events); bladeHitsBody(b, a, events); }
  else { bladeHitsBody(b, a, events); bladeHitsBody(a, b, events); }
  bodiesPush(a, b);
  solve(a); solve(b);
}

// Computer player: only presses the same controls a person has.
const LEVELS = {
  easy: { react: 0.55, swing: 0.55, guard: 0.05, wait: 1.3 },
  normal: { react: 0.3, swing: 0.76, guard: 0.3, wait: 0.6 },
  hard: { react: 0.12, swing: 1, guard: 0.7, wait: 0.14 },
};
const PLANS = [{ from: 2.45, to: -0.6 }, { from: -1.4, to: 1.5 }, { from: 2.0, to: 0.1 }, { from: 0.15, to: 0.15, poke: true }];

function botThink(me, foe, levelName, rand) {
  const L = LEVELS[levelName], inp = me.in;
  const ai = me.ai || (me.ai = { st: 'close', t: L.wait, look: 0, guardT: 0, plan: PLANS[0] });
  me.swingMul = L.swing;
  Object.assign(inp, blankInput());
  if (me.hp <= 0 || foe.hp <= 0) return;
  const dx = foe.p.pelvis.x - me.p.pelvis.x, d = Math.abs(dx), toward = Math.sign(dx) || me.f;
  ai.t -= DT; ai.look -= DT; ai.guardT -= DT;

  if (ai.look <= 0) {
    ai.look = L.react;
    const tip = foe.p.tip, fast = Math.hypot(vx(tip), vy(tip)) > 420;
    if (fast && Math.hypot(tip.x - me.p.neck.x, tip.y - me.p.neck.y) < 150 && rand() < L.guard) ai.guardT = 0.32;
  }
  if (ai.guardT > 0) {
    inp.aimTo = foe.p.tip.y < me.p.neck.y ? 1.35 : -0.4;
    inp.mx = -toward;
    return;
  }
  if (ai.st === 'close') {
    inp.aimTo = 0.8;
    if (d > 122) inp.mx = toward; else if (d < 72) inp.mx = -toward;
    if (d < 134 && ai.t <= 0) { ai.plan = PLANS[Math.floor(rand() * PLANS.length)]; ai.st = 'wind'; ai.t = 0.8; }
  } else if (ai.st === 'wind') {
    inp.aimTo = ai.plan.from;
    if (d > 118) inp.mx = toward; else if (d < 76) inp.mx = -toward;
    if (Math.abs(me.aim - ai.plan.from) < 0.25 || ai.t <= 0) { ai.st = 'strike'; ai.t = 0.5; }
  } else if (ai.st === 'strike') {
    inp.aimTo = ai.plan.to; inp.mx = d > 92 ? toward : d < 70 ? -toward : 0; inp.thrust = !!ai.plan.poke;
    if (ai.t <= 0 || (!ai.plan.poke && Math.abs(me.aim - ai.plan.to) < 0.25)) { ai.st = 'recover'; ai.t = L.wait + rand() * L.wait; }
  } else {
    inp.aimTo = 0.8;
    if (d < 104) inp.mx = -toward;
    if (ai.t <= 0) ai.st = 'close';
  }
}

if (typeof module !== 'undefined') module.exports = { makeWorld, stepWorld, botThink, blankInput, LEVELS, DT, W, GROUND, LEN };
