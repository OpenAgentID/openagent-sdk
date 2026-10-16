/**
 * <agent-eye>: the animated logo mark.
 *
 * A black circle with a white bar. The bar is an eye: it blinks by shrinking,
 * turns left and right like a stripe painted on a ball (squeezed and curved
 * near the sides, straight again in the middle), smiles, now and then fills
 * with flowing light, and never leaves the circle.
 *
 *   <script type="module" src="agent-eye.js"></script>
 *
 *   <agent-eye></agent-eye>                    alive: blinks, glances, moods, smiles, rainbows
 *   <agent-eye mode="loop"></agent-eye>        the fixed 18 s loop (same as agent-eye.svg)
 *   <agent-eye mode="still"></agent-eye>       the static mark
 *   <agent-eye state="thinking"></agent-eye>   reads: small saccades left to right
 *   <agent-eye interactive></agent-eye>        follows the pointer; a tap makes it smile,
 *                                              a tap while it smiles sets off a rainbow
 *
 * Size:   width in CSS, the size="64" attribute, or --agent-eye-size (default 48px)
 * Colors: --agent-eye-bg (circle, default #000) and --agent-eye-fg (eye and smile, default #fff)
 * JS:     el.blink(), el.look(x, y), el.glance(), el.smile(), el.rainbow()
 *
 * prefers-reduced-motion shows the still mark. Animation pauses while off screen.
 * Everything above the component is plain data and math, shared with tools/build.mjs.
 */

// ─── Geometry ──────────────────────────────────────────────────────────────
// Proportions of the master logo: the bar is 1/9 of the circle's diameter wide
// and 2/3 of it tall, with corners of 1/45 (a 180 circle with a 20 x 120 bar
// and radius 4). The circle has radius 100; the viewBox is -100 -100 200 200.

export const GEOMETRY = Object.freeze({
  radius: 100,
  barWidth: 200 / 9,
  barHeight: 400 / 3,
  cornerRadius: 200 / 45,
});

export const MOTION = Object.freeze({
  maxTurn: 55, // degrees the head turns at look = ±1
  turnRadius: 70, // horizontal travel = turnRadius · sin(turn), about ±57 at full turn
  foreshorten: 0.8, // how much the bar narrows as it turns away
  maxLift: 14, // vertical travel at lift = ±1
  closedHeight: 7, // bar height with the eye shut
  lidSquash: 0.3, // extra width when shut, so a closed eye reads as a lid
  safeRadius: 89, // every solid shape stays inside this radius
  smileLift: 2.5, // when smiling, the eye's top rises just barely…
  smileSquint: 35, // …and its foot rises this much more, making room for the smile
  squeeze: 1, // towards the sides the eye's height follows the circle's chord where it sits
  bend: 1, // and it curves like a stripe painted on the ball
});

// The smile, as on One's face: a second line, flat and horizontal, the same
// weight and corners as the eye, centred low under it. It grows in width from
// the centre while the eye shortens upward to make room.
export const MOUTH = Object.freeze({
  y: 66, // centre of the line
  halfWidth: 44, // full width 88, about the smiling eye's height
  birthHalfWidth: 20, // fades in as a short dash, never a dot (a dot under the eye reads as "!")
  thickness: 200 / 9, // same as the eye
  born: 3, // appears this much lower and rises into place
  follow: 0.6, // how far it follows a turned head, relative to the eye
  minGap: 6, // never closer than this to the eye
});

// The rainbow: light charges the bar from the bottom behind a white-hot front,
// flows upward with light packets shooting through, then leaves through the top.
export const RAINBOW = Object.freeze({
  palette: [
    [0, "#FF5E7A"], [0.14, "#FF8A5C"], [0.27, "#FFC857"], [0.36, "#FFF1D6"], [0.46, "#8DE6FF"],
    [0.57, "#3FB8FF"], [0.71, "#6C7BFF"], [0.86, "#B86BFF"], [1, "#FF5E7A"],
  ],
  flowPeriod: 180, // units per colour cycle along the flow
  flowTilt: -16, // degrees the colour fields lean
  flowSpeed: 95, // units/s at full intensity: slow and hypnotic
  flowRush: 285, // extra units/s while the light rushes in or out
  bandCore: 86, // the reveal band is fully open for |y| <= core
  bandLead: 26, // crisp leading edge
  bandTrail: 30, // soft trailing edge as the white returns from the bottom
  bandEnter: 204, // band offset before it enters (fully below the bar and its halo)
  bandExit: 212, // band offset after it leaves (fully above)
  packetPeriod: 300,
  packetSpeed: 450, // units/s: one packet every 0.67 s
  packetOpacity: 0.5,
  comet: 0.9, // white-hot front while charging
  bloomBlur: 7,
  bloomSaturate: 1.6,
  bloomGain: 1.4,
  bloomOpacity: 0.8,
  ignition: 0.5, // extra halo while the front climbs
  core: 0.22, // glass-tube highlight down the middle
});

// A pose is what the face is doing; a frame is what gets drawn.
//   look  -1 (left) … 1 (right)     lift  -1 (up) … 1 (down)
//   open   0 (shut) … 1 (rest), above 1 is wide-eyed
//   tilt   degrees, clockwise
//   smile  0 … 1: the eye shortens upward to make room (above 1 is a happy pulse)
//   mouth  0 (hidden) … 1 (full width)
//   rainbow -1 (waiting below) … 0 (full) … 1 (gone above)
//   glint  0 … 1: light packets
export const REST = Object.freeze({
  look: 0, lift: 0, open: 1, tilt: 0, smile: 0, mouth: 0, rainbow: -1, glint: 0,
});

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const r2 = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

// The eye: centre (x, y), width w, height h, bend k, tilt in degrees.
export function poseToBar({ look = 0, lift = 0, open = 1, tilt = 0, smile = 0 } = {}) {
  const turn = clamp(look, -1, 1) * MOTION.maxTurn * DEG;
  const x = MOTION.turnRadius * Math.sin(turn);
  const y = clamp(lift, -1, 1) * MOTION.maxLift - (MOTION.smileLift + MOTION.smileSquint / 2) * smile;
  const shut = 1 - clamp(open, 0, 1);
  const w =
    GEOMETRY.barWidth *
    (1 - MOTION.foreshorten * (1 - Math.cos(turn))) *
    (1 + MOTION.lidSquash * shut);
  let h = Math.max(
    MOTION.closedHeight,
    MOTION.closedHeight + (GEOMETRY.barHeight - MOTION.closedHeight) * Math.max(0, open) - MOTION.smileSquint * smile,
  );
  // The eye lives inside the ball: towards the sides its height follows the
  // circle's chord, so it is squeezed where the ball narrows…
  h *= 1 - MOTION.squeeze * (1 - Math.sqrt(1 - (x / GEOMETRY.radius) ** 2));
  h = fitHeight(x, y, w, h, tilt);
  return { x, y, w, h, k: bendAt(x, h), tilt };
}

// …and it curves like a stripe painted on the ball: its ends tuck in towards
// the centre by k while its middle stays at x. At the centre it is straight.
function bendAt(x, h) {
  const lat = Math.asin(Math.min(1, h / 2 / GEOMETRY.radius));
  return MOTION.bend * x * (1 - Math.cos(lat));
}

// The eye's outline is an inner shape with curved sides, drawn with a round-
// joined stroke as wide as two corner radii, so its corners match the master
// logo's exactly. n holds the path's numbers (see barPath).
export function barShape({ w, h, k = 0 }) {
  const r = Math.min(GEOMETRY.cornerRadius, h / 2, w / 2);
  const a = w / 2 - r;
  const b = h / 2 - r;
  return { r, a, b, n: [-a - k, -b, a - k, a + k, b, -a + k] };
}

export function barPath([left, top, right, bulge, bottom, back]) {
  return `M${r2(left)} ${r2(top)}H${r2(right)}Q${r2(bulge)} 0 ${r2(right)} ${r2(bottom)}H${r2(left)}Q${r2(back)} 0 ${r2(left)} ${r2(top)}Z`;
}

// Points that bound the eye (corner-arc centres and the middles of its curved
// sides), before adding the corner radius r.
function barExtents(x, y, w, h, tilt) {
  const { r, a, b } = barShape({ w, h });
  const k = bendAt(x, h);
  const c = Math.cos(tilt * DEG);
  const s = Math.sin(tilt * DEG);
  const local = [[a - k, -b], [a - k, b], [-a - k, -b], [-a - k, b], [a, 0], [-a, 0]];
  return { r, points: local.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]) };
}

// Tallest height up to h that keeps the whole eye inside the safe radius, so
// it shortens against the curve of the circle instead of crossing it.
function fitHeight(x, y, w, h, tilt) {
  const inside = (hh) => {
    const { r, points } = barExtents(x, y, w, hh, tilt);
    return points.every(([px, py]) => Math.hypot(px, py) + r <= MOTION.safeRadius);
  };
  if (inside(h)) return h;
  let lo = 0;
  let hi = h;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// The mouth is a rounded rectangle: centre (mx, my), half-width ma, height mt.
export function poseToMouth({ look = 0, lift = 0, mouth = 0 } = {}) {
  const M = MOUTH;
  const m = Math.max(0, mouth);
  if (m === 0) return { mx: 0, my: M.y + M.born, ma: M.birthHalfWidth, mt: M.thickness, mo: 0 };
  const turn = clamp(look, -1, 1) * MOTION.maxTurn * DEG;
  const mx = M.follow * MOTION.turnRadius * Math.sin(turn);
  const my = M.y + M.born * (1 - Math.min(1, m)) + 0.5 * clamp(lift, -1, 1) * MOTION.maxLift;
  const mt = M.thickness;
  const r = GEOMETRY.cornerRadius;
  // From a short dash out to full width, narrower when the head turns.
  let ma = (M.birthHalfWidth + (M.halfWidth - M.birthHalfWidth) * m) * (1 - 0.5 * (1 - Math.cos(turn)));
  // Keep the rounded corners inside the safe radius.
  const reach = (a) => Math.hypot(Math.abs(mx) + a - r, my + mt / 2 - r) + r;
  if (reach(ma) > MOTION.safeRadius) {
    let lo = 0, hi = ma;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (reach(mid) > MOTION.safeRadius) hi = mid;
      else lo = mid;
    }
    ma = lo;
  }
  return { mx, my, ma, mt, mo: clamp((m - 0.05) / 0.4, 0, 1) };
}

export function rainbowFx(rainbow = -1, glint = 0) {
  const R = RAINBOW;
  const amount = 1 - Math.min(1, Math.abs(rainbow));
  const rising = rainbow < 0;
  const packets = R.packetOpacity * clamp(glint, 0, 1);
  return {
    amount,
    fx: amount > 0.001 || packets > 0.001 ? 1 : 0,
    band: rising ? -rainbow * R.bandEnter : -rainbow * R.bandExit,
    comet: rising ? R.comet * smoothstep(0, 0.08, amount) * (1 - smoothstep(0.75, 1, amount)) : 0,
    bloom: Math.min(1, R.bloomOpacity * amount + (rising ? R.ignition * 4 * amount * (1 - amount) : 0)),
    packets,
    core: R.core * amount,
  };
}

export const flowSpeed = (amount) => RAINBOW.flowSpeed + RAINBOW.flowRush * (1 - amount);

export function poseToFrame(pose) {
  const p = { ...REST, ...pose };
  return { ...poseToBar(p), ...poseToMouth(p), ...rainbowFx(p.rainbow, p.glint) };
}

// ─── Easing ────────────────────────────────────────────────────────────────

export const EASE = Object.freeze({
  linear: [0, 0, 1, 1],
  shut: [0.6, 0, 0.9, 0.55], // lid accelerates closed
  snap: [0.1, 0.9, 0.25, 1], // saccades and lid opening: fast, then settle
  settle: [0.3, 0, 0.3, 1], // recovering from an overshoot
  glide: [0.45, 0, 0.25, 1], // slow, deliberate moves
  emerge: [0.2, 0.6, 0.35, 1], // the smile's birth: moving from the first frame
  charge: [0.4, 0, 0.2, 1], // light shooting up the bar, landing softly
  exit: [0.45, 0, 0.7, 0.9], // light lifting off and accelerating out of the top
});

export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const EASE_FN = Object.fromEntries(
  Object.entries(EASE).map(([name, v]) => [name, cubicBezier(...v)]),
);

// ─── Curves and moments ────────────────────────────────────────────────────
// A curve is [[seconds, value, ease into this key], …] for one pose channel.

export function sampleCurve(curve, t) {
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1, ease = "linear"] = curve[i];
    if (t < t1) {
      const [t0, v0] = curve[i - 1];
      return v0 + (v1 - v0) * EASE_FN[ease]((t - t0) / (t1 - t0));
    }
  }
  return curve[curve.length - 1][1];
}

const curveEnd = (curve) => curve[curve.length - 1][0];
export const momentDuration = (moment) => Math.max(...Object.values(moment).map(curveEnd));

// One blink: 80 ms close, 50 ms shut, 170 ms open with a little overshoot.
// Values multiply the current openness.
export const BLINK = [[0, 1], [0.08, 0, "shut"], [0.13, 0], [0.3, 1.04, "snap"], [0.42, 1, "settle"]];
export const DOUBLE_BLINK = [
  [0, 1], [0.07, 0, "shut"], [0.11, 0], [0.23, 1, "snap"], [0.3, 1],
  [0.37, 0, "shut"], [0.41, 0], [0.57, 1.04, "snap"], [0.69, 1, "settle"],
];

// The smile, 2.9 s: the eye shortens upward, a second line appears low under
// it and grows in width from the centre, one happy pulse, then the line
// draws back in and fades while the eye returns to full length.
export const SMILE = Object.freeze({
  smile: [[0, 0], [0.36, 1, "glide"], [1.3, 1], [1.46, 1.12, "snap"], [1.76, 1, "settle"], [2.2, 1], [2.7, -0.06, "glide"], [2.9, 0, "settle"]],
  mouth: [[0, 0], [0.2, 0], [0.46, 0.8, "emerge"], [0.62, 1.04, "snap"], [0.82, 1, "settle"], [1.3, 1], [1.46, 1.05, "snap"], [1.76, 1, "settle"], [2.05, 1], [2.26, 0.12, "glide"], [2.32, 0]],
});

// The rainbow, 2.3 s: the front shoots up the bar in 0.42 s, the colours flow
// with light packets for 1.3 s, then the light leaves through the top.
export const RAINBOW_MOMENT = Object.freeze({
  rainbow: [[0, -1], [0.42, 0, "charge"], [1.72, 0], [2.32, 1, "exit"]],
  glint: [[0, 0], [0.5, 0], [0.62, 1], [1.55, 1], [1.8, 0, "glide"]],
});
const PACKET_ENTRY = 0.6; // s after the rainbow starts, the first packet reaches the bar's foot

// Packet phase that puts a packet's head at the bar's foot PACKET_ENTRY s after the start.
export function packetPhase(sinceStart) {
  const R = RAINBOW;
  const head = 0.02 * R.packetPeriod; // head position inside one period (see PACKET_STOPS)
  const foot = GEOMETRY.barHeight / 2 + 5;
  return head - foot + R.packetPeriod + R.packetSpeed * (sinceStart - PACKET_ENTRY);
}

// ─── The loop ──────────────────────────────────────────────────────────────
// Base script: [seconds, changes to the pose, ease into this key]. Each key
// inherits the previous pose. Moments overlay their own channels on top.

const LOOP_SCRIPT = [
  [0.0],
  [1.0],
  [1.08, { open: 0 }, "shut"],
  [1.13],
  [1.3, { open: 1.04 }, "snap"],
  [1.42, { open: 1 }, "settle"],

  [2.1],
  [2.3, { look: 0.92 }, "snap"],
  [2.45, { look: 0.85 }, "settle"],
  [3.4],

  [3.48, { look: 0.55, open: 0.2 }, "shut"],
  [3.54, { look: 0.1, open: 0 }],
  [3.72, { look: -0.93, open: 1.03 }, "snap"],
  [3.86, { look: -0.85, open: 1 }, "settle"],
  [4.9],

  [5.14, { look: 0.05 }, "snap"],
  [5.28, { look: 0 }, "settle"],
  [5.7],
  [5.77, { open: 0 }, "shut"],
  [5.81],
  [5.93, { open: 1 }, "snap"],
  [6.0],
  [6.07, { open: 0 }, "shut"],
  [6.11],
  [6.27, { open: 1.04 }, "snap"],
  [6.39, { open: 1 }, "settle"],

  // 6.9–9.8 the smile
  [10.4],
  [10.9, { look: 0.22, lift: -0.45, open: 0.58, tilt: -8 }, "glide"],
  [12.0, { look: 0.32, open: 0.55 }, "glide"],
  [12.22, { look: 0, lift: 0, open: 1.1, tilt: 0 }, "snap"],
  [12.4, { open: 1 }, "settle"],
  // 12.55–14.87 the "aha" lights the eye up: the rainbow

  [15.4],
  [15.56, { look: -0.5 }, "snap"],
  [15.66, { look: -0.45 }, "settle"],
  [16.1],
  [16.28, { look: 0.5 }, "snap"],
  [16.38, { look: 0.45 }, "settle"],
  [16.8],
  [16.88, { look: 0.3, open: 0.3 }, "shut"],
  [16.93, { look: 0.12, open: 0 }],
  [17.1, { look: -0.02, open: 1.03 }, "snap"],
  [17.24, { look: 0, open: 1 }, "settle"],
  [18.0],
];

export const LOOP_DURATION = 18;
export const LOOP_MOMENTS = Object.freeze([
  { at: 6.9, name: "smile", moment: SMILE },
  { at: 12.55, name: "rainbow", moment: RAINBOW_MOMENT },
]);
const LOOP_RAINBOW_AT = 12.55;

const LOOP_KEYS = (() => {
  let pose = { ...REST };
  return LOOP_SCRIPT.map(([t, change = {}, ease = "linear"]) => {
    pose = { ...pose, ...change };
    return { t, pose, ease };
  });
})();

const wrap = (t) => ((t % LOOP_DURATION) + LOOP_DURATION) % LOOP_DURATION;

export function loopPose(t) {
  t = wrap(t);
  let i = 1;
  while (i < LOOP_KEYS.length - 1 && LOOP_KEYS[i].t <= t) i++;
  const a = LOOP_KEYS[i - 1], b = LOOP_KEYS[i];
  const k = EASE_FN[b.ease](clamp((t - a.t) / (b.t - a.t), 0, 1));
  const pose = {};
  for (const ch in a.pose) pose[ch] = a.pose[ch] + (b.pose[ch] - a.pose[ch]) * k;
  for (const { at, moment } of LOOP_MOMENTS) {
    if (t < at) continue;
    for (const ch in moment) pose[ch] = sampleCurve(moment[ch], t - at);
  }
  return pose;
}

// The colour flow speeds up while light rushes in or out, so its phase is the
// integral of flowSpeed over the loop, scaled to a whole number of periods.
const LOOP_FPS = 240;
let flowTable = null;
function loopFlowPhase(t) {
  if (!flowTable) {
    const n = LOOP_DURATION * LOOP_FPS;
    const table = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) {
      const amount = 1 - Math.min(1, Math.abs(loopPose((i - 0.5) / LOOP_FPS).rainbow));
      table[i] = table[i - 1] + flowSpeed(amount) / LOOP_FPS;
    }
    const scale = (Math.round(table[n] / RAINBOW.flowPeriod) * RAINBOW.flowPeriod) / table[n];
    for (let i = 0; i <= n; i++) table[i] *= scale;
    flowTable = table;
  }
  const f = wrap(t) * LOOP_FPS;
  const i = Math.min(Math.floor(f), flowTable.length - 2);
  return flowTable[i] + (flowTable[i + 1] - flowTable[i]) * (f - i);
}

export function loopFrame(t) {
  const frame = poseToFrame(loopPose(t));
  frame.flow = loopFlowPhase(t);
  frame.packet = packetPhase(wrap(t) - LOOP_RAINBOW_AT);
  return frame;
}

// ─── Markup ────────────────────────────────────────────────────────────────
// One SVG structure for both runtimes. `anim` maps element names to SMIL
// children (used by tools/build.mjs); the component passes none and sets the
// same attributes from script. Colours are attributes, which the component's
// CSS overrides with --agent-eye-bg and --agent-eye-fg.

const PACKET_STOPS = [[0, 0], [0.02, 1], [0.06, 0.45], [0.2, 0], [1, 0]]; // white, crisp head at the top
const COMET = { y1: -112, y2: -20, stops: [[0, 0], [0.13, 1], [0.22, 1], [1, 0]] }; // white, rides the band's front
const CORE_STOPS = [[0, 0], [0.28, 0], [0.5, 1], [0.72, 0], [1, 0]]; // white, across the bar's width

export function flowVector(period, tilt) {
  return { x2: r2(-period * Math.sin(tilt * DEG)), y2: r2(period * Math.cos(tilt * DEG)) };
}

export function markup(id = "ae", anim = {}) {
  const a = (name) => anim[name] || "";
  const R = RAINBOW;
  const G = GEOMETRY;
  const rest = poseToFrame(REST);
  const restBar = barShape(rest);
  const stop = (o, color, opacity) =>
    `<stop offset="${o}" stop-color="${color}"${opacity === undefined ? "" : ` stop-opacity="${opacity}"`}/>`;
  const white = (stops) => stops.map(([o, op]) => stop(o, "#fff", op)).join("");
  const S = R.bloomSaturate;
  const bloomMatrix = [
    [0.213 + 0.787 * S, 0.715 - 0.715 * S, 0.072 - 0.072 * S, 0, 0],
    [0.213 - 0.213 * S, 0.715 + 0.285 * S, 0.072 - 0.072 * S, 0, 0],
    [0.213 - 0.213 * S, 0.715 - 0.715 * S, 0.072 + 0.928 * S, 0, 0],
    [0, 0, 0, R.bloomGain, 0],
  ].flat().map((v) => +v.toFixed(4)).join(" ");
  const top = -(R.bandCore + R.bandLead);
  const span = 2 * R.bandCore + R.bandLead + R.bandTrail;
  const flow = flowVector(R.flowPeriod, R.flowTilt);
  const bar = `href="#${id}-bar"`;
  const paint = (name) => `${bar} fill="url(#${id}-${name})" stroke="url(#${id}-${name})"`;
  return (
    `<defs>` +
    `<path id="${id}-bar" d="${barPath(restBar.n)}" stroke-width="${r2(2 * restBar.r)}" stroke-linejoin="round">${a("bar")}</path>` +
    `<clipPath id="${id}-disc"><circle r="${G.radius}"/></clipPath>` +
    `<linearGradient id="${id}-flow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${flow.x2}" y2="${flow.y2}" spreadMethod="repeat">` +
    R.palette.map(([o, c]) => stop(o, c)).join("") + a("flow") + `</linearGradient>` +
    `<linearGradient id="${id}-packets" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${R.packetPeriod}" spreadMethod="repeat">` +
    white(PACKET_STOPS) + a("packets") + `</linearGradient>` +
    `<linearGradient id="${id}-comet" gradientUnits="userSpaceOnUse" x1="0" y1="${COMET.y1}" x2="0" y2="${COMET.y2}" gradientTransform="translate(0 ${R.bandEnter})">` +
    white(COMET.stops) + a("comet") + `</linearGradient>` +
    `<linearGradient id="${id}-core" x1="0" y1="0" x2="1" y2="0">${white(CORE_STOPS)}</linearGradient>` +
    `<linearGradient id="${id}-band" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${top + span}" gradientTransform="translate(0 ${R.bandEnter})">` +
    stop(0, "#000") + stop(r2(R.bandLead / span), "#fff") +
    stop(r2((R.bandLead + 2 * R.bandCore) / span), "#fff") + stop(1, "#000") +
    a("band") + `</linearGradient>` +
    `<mask id="${id}-mask" maskUnits="userSpaceOnUse" x="-55" y="-125" width="110" height="250">` +
    `<rect x="-55" y="-125" width="110" height="250" fill="url(#${id}-band)"/></mask>` +
    `<filter id="${id}-bloom" filterUnits="userSpaceOnUse" x="-50" y="-105" width="100" height="210" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur stdDeviation="${R.bloomBlur}"/><feColorMatrix type="matrix" values="${bloomMatrix}"/></filter>` +
    `</defs>` +
    `<circle class="disc" r="${G.radius}" fill="#000"/>` +
    `<g clip-path="url(#${id}-disc)"><g class="eye">${a("eye")}<g class="tilt">${a("tilt")}` +
    `<use class="bar" ${bar} fill="#fff" stroke="#fff"/>` +
    `<g class="fx" display="none" mask="url(#${id}-mask)">${a("fx")}` +
    `<g class="bloom" filter="url(#${id}-bloom)" opacity="0">${a("bloom")}` +
    `<use ${paint("flow")}/>` +
    `<use class="comet" ${paint("comet")} opacity="0">${a("cometOpacity")}</use></g>` +
    `<use ${paint("flow")}/>` +
    `<use class="packets" ${paint("packets")} opacity="0">${a("packetOpacity")}</use>` +
    `<use class="comet" ${paint("comet")} opacity="0">${a("cometOpacity")}</use>` +
    `<use class="core" ${paint("core")} opacity="0">${a("core")}</use>` +
    `</g></g></g></g>` +
    `<rect class="mouth" x="${r2(rest.mx - rest.ma)}" y="${r2(rest.my - rest.mt / 2)}" width="${r2(2 * rest.ma)}" height="${r2(rest.mt)}" rx="${r2(G.cornerRadius)}" fill="#fff" opacity="0">${a("mouth")}</rect>`
  );
}

// ─── Web component ─────────────────────────────────────────────────────────

const TAG = "agent-eye";

if (typeof window !== "undefined" && window.customElements && !customElements.get(TAG)) {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const side = () => (Math.random() < 0.5 ? -1 : 1);
  let instances = 0;

  const IDLE_ACTS = [
    ["glance", 5], ["drift", 3], ["lookAround", 2], ["curious", 2], ["doubleBlink", 1],
    ["smile", 1.2], ["rainbow", 0.5],
  ];
  const pickAct = () => {
    let n = Math.random() * IDLE_ACTS.reduce((s, [, w]) => s + w, 0);
    for (const [name, w] of IDLE_ACTS) if ((n -= w) < 0) return name;
    return "glance";
  };
  const MOMENTS = { smile: SMILE, rainbow: RAINBOW_MOMENT };
  const COOLDOWN = { smile: 14, rainbow: 30 };

  const STYLE = `
    :host { display: inline-block; width: var(--agent-eye-size, 48px); aspect-ratio: 1 / 1;
            line-height: 0; vertical-align: middle; -webkit-tap-highlight-color: transparent; }
    :host([hidden]) { display: none; }
    svg { display: block; width: 100%; height: 100%; overflow: hidden; }
    .disc { fill: var(--agent-eye-bg, #000); }
    .bar { fill: var(--agent-eye-fg, #fff); stroke: var(--agent-eye-fg, #fff); }
    .mouth { fill: var(--agent-eye-fg, #fff); }`;

  // One animated number: an eased tween toward a target, or a curve playing.
  class Channel {
    constructor(v) {
      this.value = this.from = this.target = v;
      this.start = 0;
      this.dur = 0;
      this.ease = EASE_FN.linear;
      this.curve = null;
    }
    to(target, dur, ease, now) {
      this.curve = null;
      this.from = this.value;
      this.target = target;
      this.start = now;
      this.dur = dur;
      this.ease = EASE_FN[ease];
    }
    hold(v) {
      this.curve = null;
      this.value = this.from = this.target = v;
      this.dur = 0;
    }
    play(curve, now) {
      this.curve = curve;
      this.start = now;
    }
    update(now) {
      if (this.curve) {
        const t = now - this.start;
        this.value = sampleCurve(this.curve, t);
        if (t >= curveEnd(this.curve)) this.hold(this.value);
        return this.value;
      }
      const k = this.dur > 0 ? Math.min(1, (now - this.start) / this.dur) : 1;
      this.value = this.from + (this.target - this.from) * this.ease(k);
      return this.value;
    }
  }

  class AgentEye extends HTMLElement {
    static get observedAttributes() {
      return ["mode", "state", "interactive", "size", "label"];
    }

    constructor() {
      super();
      const id = `ae${++instances}`;
      this.attachShadow({ mode: "open" }).innerHTML =
        `<style>${STYLE}</style><svg viewBox="-100 -100 200 200" part="svg" aria-hidden="true">${markup(id)}</svg>`;
      const $ = (sel) => this.shadowRoot.querySelector(sel);
      const $$ = (sel) => [...this.shadowRoot.querySelectorAll(sel)];
      this._el = {
        disc: $(".disc"), bar: $(`#${id}-bar`), eye: $(".eye"), mouth: $(".mouth"),
        fx: $(".fx"), bloom: $(".bloom"), comets: $$(".comet"), packets: $(".packets"), core: $(".core"),
        flow: $(`#${id}-flow`), packetGrad: $(`#${id}-packets`), cometGrad: $(`#${id}-comet`), band: $(`#${id}-band`),
      };
      this._ch = Object.fromEntries(Object.entries(REST).map(([k, v]) => [k, new Channel(v)]));
      this._clock = 0;
      this._queue = [];
      this._raf = 0;
      this._visible = true;
      this._blinkAt = -Infinity;
      this._blinkCurve = BLINK;
      this._nextBlink = 0;
      this._nextAct = 0;
      this._loopStart = 0;
      this._target = { look: 0, lift: 0 };
      this._pointerAt = -Infinity;
      this._tracking = false;
      this._momentKind = null;
      this._momentUntil = -Infinity;
      this._queuedRainbow = false;
      this._lastMoment = { smile: -Infinity, rainbow: -Infinity };
      this._rainbowAt = -Infinity;
      this._flowPhase = 0;
      this._px = 48;
      this._lightDisc = false;
      this._shown = { mouth: false, fx: false, bloom: true };
      this._frame = this._frame.bind(this);
      this._sync = this._sync.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    }

    // ── Public API ──

    get mode() {
      const m = this.getAttribute("mode");
      return m === "loop" || m === "still" ? m : "alive";
    }
    set mode(v) {
      this.setAttribute("mode", v);
    }
    get state() {
      return this.getAttribute("state") === "thinking" ? "thinking" : "idle";
    }
    set state(v) {
      this.setAttribute("state", v);
    }
    get interactive() {
      return this.hasAttribute("interactive") && this.getAttribute("interactive") !== "false";
    }
    set interactive(v) {
      this.toggleAttribute("interactive", !!v);
    }

    blink() {
      if (this._clock >= this._momentUntil) this._blink(this._clock, BLINK);
    }

    /** Look toward x (-1 left … 1 right) and y (-1 up … 1 down), then carry on. */
    look(x = 0, y = 0, holdSeconds = 1.5) {
      const now = this._clock;
      this._interrupt();
      this._nextAct = Math.max(this._momentUntil, now + this._saccade(now, clamp(x, -1, 1), clamp(y, -1, 1)) + holdSeconds);
    }

    glance() {
      const now = this._clock;
      this._interrupt();
      this._nextAct = Math.max(this._momentUntil, now + this._glance(now) + rand(0.6, 1.6));
    }

    /** Smile for about 3 s. */
    smile() {
      this._moment("smile", this._clock);
    }

    /** Fill with flowing light for about 2.3 s. Called during a smile, it follows the smile. */
    rainbow() {
      this._moment("rainbow", this._clock);
    }

    // ── Lifecycle ──

    connectedCallback() {
      if (!this.hasAttribute("role")) this.setAttribute("role", "img");
      this._applyLabel();
      this._applySize();
      this._io = new IntersectionObserver(([entry]) => {
        this._visible = entry.isIntersecting;
        this._sync();
      });
      this._io.observe(this);
      this._ro = new ResizeObserver(([entry]) => this._resized(entry.contentRect.width));
      this._ro.observe(this);
      this._reducedMotion?.addEventListener?.("change", this._sync);
      this.addEventListener("pointerdown", this._onPointerDown);
      this._applyInteractive();
      this._restart();
      this._sync();
    }

    disconnectedCallback() {
      this._io?.disconnect();
      this._ro?.disconnect();
      this._reducedMotion?.removeEventListener?.("change", this._sync);
      this.removeEventListener("pointerdown", this._onPointerDown);
      window.removeEventListener("pointermove", this._onPointerMove);
      this._stop();
    }

    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === "label") this._applyLabel();
      else if (name === "size") this._applySize();
      else if (name === "interactive") this._applyInteractive();
      else if (name === "mode") {
        this._restart();
        this._sync();
      } else if (name === "state") this._changeState();
    }

    _applyLabel() {
      this.setAttribute("aria-label", this.getAttribute("label") || "Logo");
    }

    _applySize() {
      const s = this.getAttribute("size");
      if (s) this.style.setProperty("--agent-eye-size", /^\d+(\.\d+)?$/.test(s) ? `${s}px` : s);
      else this.style.removeProperty("--agent-eye-size");
    }

    _applyInteractive() {
      if (this.interactive) window.addEventListener("pointermove", this._onPointerMove, { passive: true });
      else {
        window.removeEventListener("pointermove", this._onPointerMove);
        this._pointerAt = -Infinity;
      }
    }

    // Below 32 px the light packets and the white front are too small to read,
    // and below 40 px the halo only muddies the edge, so they switch off.
    _resized(px) {
      if (!px) return;
      const wasSmall = this._px <= 32;
      this._px = px;
      if (wasSmall !== this._px <= 32) {
        const v = this._px <= 32 ? flowVector(260, 0) : flowVector(RAINBOW.flowPeriod, RAINBOW.flowTilt);
        this._el.flow.setAttribute("x2", v.x2);
        this._el.flow.setAttribute("y2", v.y2);
      }
    }

    // ── Frame loop ──

    get _animating() {
      return this.mode !== "still" && !this._reducedMotion?.matches;
    }

    _sync() {
      const run = this.isConnected && this._visible && this._animating;
      if (run && !this._raf) {
        this._last = performance.now();
        this._raf = requestAnimationFrame(this._frame);
      } else if (!run) {
        this._stop();
        if (!this._animating) this._render(poseToFrame(REST));
      }
    }

    _stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    _frame(ms) {
      // A private clock that only advances while drawing, so time spent
      // hidden or off screen never fires a backlog of moves at once.
      const dt = clamp((ms - this._last) / 1000, 0, 0.1);
      this._last = ms;
      this._clock += dt;
      this._tick(this._clock, dt);
      this._raf = requestAnimationFrame(this._frame);
    }

    _restart() {
      const now = this._clock;
      this._queue = [];
      for (const [k, ch] of Object.entries(this._ch)) ch.hold(REST[k]);
      this._blinkAt = -Infinity;
      this._momentUntil = -Infinity;
      this._momentKind = null;
      this._queuedRainbow = false;
      this._loopStart = now;
      this._nextBlink = now + rand(1.2, 3);
      this._nextAct = now + rand(0.6, 1.6);
      this._render(this.mode === "loop" ? loopFrame(0) : poseToFrame(REST));
    }

    _changeState() {
      const now = this._clock;
      const { look, lift, open, tilt } = this._ch;
      this._interrupt();
      if (this.state === "thinking") {
        this._nextAct = Math.max(now, this._momentUntil);
      } else {
        look.to(0, 0.35, "glide", now);
        lift.to(0, 0.35, "glide", now);
        open.to(1, 0.35, "glide", now);
        tilt.to(0, 0.35, "glide", now);
        this._nextAct = Math.max(this._momentUntil, now + rand(0.8, 1.6));
      }
    }

    _tick(now, dt) {
      if (this.mode === "loop") {
        this._render(loopFrame(now - this._loopStart));
        return;
      }
      while (this._queue.length && this._queue[0].at <= now) this._queue.shift().fn(now);

      const tracking = this.interactive && now - this._pointerAt < 1.6;
      if (tracking !== this._tracking) {
        this._tracking = tracking;
        if (tracking) this._startTracking(now);
        else this._endTracking(now);
      }
      if (this._queuedRainbow && now >= this._momentUntil) {
        this._queuedRainbow = false;
        this._moment("rainbow", now);
      }
      if (tracking) this._follow(dt);
      else if (now >= this._nextAct && !this._queue.length) this._act(now);
      if (now >= this._nextBlink && now >= this._momentUntil) {
        this._blink(now, Math.random() < 0.18 ? DOUBLE_BLINK : BLINK);
      }

      const c = this._ch;
      const blink = sampleCurve(this._blinkCurve, now - this._blinkAt);
      const breath = 1 + 0.012 * Math.sin((now * TAU) / 4.6);
      const pose = {};
      for (const k in c) pose[k] = c[k].update(now);
      pose.open *= blink * breath;
      const frame = poseToFrame(pose);
      if (frame.fx) {
        this._flowPhase += flowSpeed(frame.amount) * dt;
        frame.flow = this._flowPhase;
        frame.packet = packetPhase(now - this._rainbowAt);
      }
      this._render(frame);
    }

    _render(f) {
      const el = this._el;
      el.eye.setAttribute("transform", `translate(${r2(f.x)} ${r2(f.y)}) rotate(${r2(f.tilt)})`);
      const shape = barShape(f);
      el.bar.setAttribute("d", barPath(shape.n));
      el.bar.setAttribute("stroke-width", r2(2 * shape.r));

      const mouth = f.mo > 0.001;
      if (mouth !== this._shown.mouth) el.mouth.setAttribute("display", (this._shown.mouth = mouth) ? "inline" : "none");
      if (mouth) {
        el.mouth.setAttribute("x", r2(f.mx - f.ma));
        el.mouth.setAttribute("y", r2(f.my - f.mt / 2));
        el.mouth.setAttribute("width", r2(2 * f.ma));
        el.mouth.setAttribute("opacity", r2(f.mo));
      }

      const fx = !!f.fx;
      if (fx !== this._shown.fx) el.fx.setAttribute("display", (this._shown.fx = fx) ? "inline" : "none");
      if (!fx) return;
      const small = this._px <= 32;
      const bloom = !this._lightDisc && this._px >= 40 && f.bloom > 0.001;
      if (bloom !== this._shown.bloom) el.bloom.setAttribute("display", (this._shown.bloom = bloom) ? "inline" : "none");
      const band = `translate(0 ${r2(f.band)})`;
      el.band.setAttribute("gradientTransform", band);
      el.cometGrad.setAttribute("gradientTransform", band);
      const comet = small ? 0 : r2(f.comet);
      for (const c of el.comets) c.setAttribute("opacity", comet);
      el.bloom.setAttribute("opacity", r2(f.bloom));
      el.packets.setAttribute("opacity", small ? 0 : r2(f.packets));
      el.core.setAttribute("opacity", r2(f.core));
      const tilt = small ? 0 : RAINBOW.flowTilt;
      const period = small ? 260 : RAINBOW.flowPeriod;
      el.flow.setAttribute("gradientTransform", `translate(0 ${r2(-(f.flow % period) / Math.cos(tilt * DEG))})`);
      el.packetGrad.setAttribute("gradientTransform", `translate(0 ${r2(-(f.packet % RAINBOW.packetPeriod))})`);
    }

    // keep: survives interruptions (pointer tracking, look(), glance()).
    _after(delay, fn, keep = false) {
      this._queue.push({ at: this._clock + delay, fn, keep });
      this._queue.sort((a, b) => a.at - b.at);
    }

    _interrupt() {
      this._queue = this._queue.filter((q) => q.keep);
    }

    // ── Moments ──

    _moment(kind, now) {
      if (this.mode !== "alive" || !this._animating) return 0;
      if (now < this._momentUntil) {
        if (kind === "rainbow" && this._momentKind === "smile") this._queuedRainbow = true;
        return 0;
      }
      this._interrupt();
      const lead = this._center(now);
      this._after(lead, (n) => {
        for (const [ch, curve] of Object.entries(MOMENTS[kind])) this._ch[ch].play(curve, n);
        if (kind === "rainbow") this._startRainbow(n);
      }, true);
      this._momentKind = kind;
      this._momentUntil = now + lead + momentDuration(MOMENTS[kind]);
      this._lastMoment[kind] = now;
      this._nextAct = this._momentUntil + rand(0.6, 1.4);
      return this._momentUntil - now;
    }

    _startRainbow(now) {
      this._rainbowAt = now;
      this._flowPhase = rand(0, RAINBOW.flowPeriod);
      // The coloured halo is made for a dark disc; on a light one it only stains.
      const m = getComputedStyle(this._el.disc).fill.match(/[\d.]+/g);
      this._lightDisc = !!m && 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] > 140;
    }

    // Bring the eye home before a moment so the face reads straight on.
    _center(now) {
      const { look, lift, open, tilt } = this._ch;
      const off = Math.abs(look.value) > 0.02 || Math.abs(lift.value) > 0.02 ||
        Math.abs(tilt.value) > 0.2 || Math.abs(open.value - 1) > 0.02;
      if (!off) return 0;
      for (const [ch, v] of [[look, 0], [lift, 0], [open, 1], [tilt, 0]]) ch.to(v, 0.3, "glide", now);
      return 0.3;
    }

    // ── Behaviors ──
    // Each one schedules its moves and returns how long it takes.

    _act(now) {
      const thinking = this.state === "thinking";
      let name = thinking ? "read" : pickAct();
      if (MOMENTS[name] && now - this._lastMoment[name] < COOLDOWN[name]) name = "glance";
      const dur = this[`_${name}`](now);
      if (!MOMENTS[name]) this._nextAct = now + dur + (thinking ? 0 : rand(0.6, 2.4));
    }

    _smile(now) {
      return this._moment("smile", now);
    }

    _rainbow(now) {
      return this._moment("rainbow", now);
    }

    _blink(now, curve) {
      if (now - this._blinkAt < this._blinkCurve[this._blinkCurve.length - 1][0]) return;
      this._blinkAt = now;
      this._blinkCurve = curve;
      this._nextBlink = now + (this.state === "thinking" ? rand(3, 7) : rand(2.4, 6));
    }

    // A quick eye jump with a small overshoot, like a real saccade.
    _saccade(now, x, y = 0) {
      const { look, lift } = this._ch;
      const dur = 0.11 + 0.11 * Math.abs(x - look.value);
      look.to(x + (x - look.value) * 0.07, dur, "snap", now);
      lift.to(y, dur * 1.3, "snap", now);
      this._after(dur, (t) => look.to(x, 0.16, "settle", t));
      return dur + 0.16;
    }

    _glance(now) {
      const v = this._ch.look.value;
      const dir = Math.abs(v) > 0.3 ? -Math.sign(v) : side();
      if (Math.random() < 0.3) this._blink(now, BLINK);
      const t = this._saccade(now, dir * rand(0.55, 0.9), rand(-0.3, 0.3)) + rand(0.7, 1.6);
      this._after(t, (n) => this._saccade(n, rand(-0.06, 0.06), 0));
      return t + 0.4;
    }

    _drift(now) {
      const { look, lift } = this._ch;
      look.to(clamp(look.value + rand(-0.25, 0.25), -0.35, 0.35), 0.7, "glide", now);
      lift.to(rand(-0.2, 0.2), 0.7, "glide", now);
      return 0.7 + rand(0.4, 1.2);
    }

    _lookAround(now) {
      const dir = side();
      let t = this._saccade(now, dir * 0.8, -0.1) + rand(0.5, 0.8);
      this._after(t, (n) => {
        this._blink(n, BLINK);
        this._saccade(n, -dir * 0.8, -0.1);
      });
      t += 0.35 + rand(0.5, 0.8);
      this._after(t, (n) => this._saccade(n, 0, 0));
      return t + 0.35;
    }

    // Squint, tilt and peer, then pop wide open.
    _curious(now) {
      const dir = side();
      const { look, lift, open, tilt } = this._ch;
      look.to(dir * 0.22, 0.5, "glide", now);
      lift.to(-0.45, 0.5, "glide", now);
      open.to(0.58, 0.5, "glide", now);
      tilt.to(-dir * 8, 0.5, "glide", now);
      const hold = rand(0.9, 1.5);
      this._after(0.5, (n) => look.to(dir * 0.32, hold, "glide", n));
      this._after(0.5 + hold, (n) => this._pop(n));
      return 0.5 + hold + 0.4;
    }

    _pop(now) {
      const { look, lift, open, tilt } = this._ch;
      open.to(1.1, 0.18, "snap", now);
      look.to(0, 0.2, "snap", now);
      lift.to(0, 0.2, "snap", now);
      tilt.to(0, 0.2, "snap", now);
      this._after(0.18, (n) => open.to(1, 0.2, "settle", n), true);
    }

    _doubleBlink(now) {
      this._blink(now, DOUBLE_BLINK);
      return 0.7;
    }

    // Thinking: narrowed eye reading a line in small jumps, then a return sweep.
    _read(now) {
      const { open, tilt } = this._ch;
      open.to(0.72, 0.4, "glide", now);
      tilt.to(0, 0.3, "glide", now);
      let t = this._saccade(now, -0.55, 0.15);
      const steps = 3 + Math.floor(Math.random() * 3);
      for (let i = 1; i <= steps; i++) {
        t += rand(0.16, 0.34);
        const x = -0.55 + (1.1 * i) / steps;
        this._after(t, (n) => this._saccade(n, x, 0.15));
        t += 0.15;
      }
      t += rand(0.2, 0.45);
      if (Math.random() < 0.4) this._after(t, (n) => this._blink(n, BLINK));
      return t;
    }

    // ── Pointer ──

    _onPointerMove(e) {
      const r = this.getBoundingClientRect();
      const reach = Math.max(window.innerWidth, window.innerHeight) * 0.4;
      this._target.look = Math.tanh(((e.clientX - (r.left + r.width / 2)) / reach) * 1.4);
      this._target.lift = Math.tanh(((e.clientY - (r.top + r.height / 2)) / reach) * 1.4);
      this._pointerAt = this._clock;
    }

    // A tap makes it smile; a tap while it smiles sets off a rainbow after the smile.
    _onPointerDown() {
      if (!this.interactive) return;
      this._moment(this._momentKind === "smile" && this._clock < this._momentUntil ? "rainbow" : "smile", this._clock);
    }

    _startTracking(now) {
      const { open, tilt } = this._ch;
      const base = this.state === "thinking" ? 0.72 : 1;
      this._interrupt();
      if (open.target < base && !open.curve) open.to(base, 0.25, "glide", now);
      tilt.to(0, 0.25, "glide", now);
    }

    _endTracking(now) {
      const back = rand(0.5, 1.1);
      this._after(back, (n) => this._saccade(n, 0, 0));
      this._nextAct = Math.max(this._momentUntil, now + back + rand(0.8, 1.8));
    }

    _follow(dt) {
      const k = 1 - Math.exp(-dt / 0.08);
      const { look, lift } = this._ch;
      look.hold(look.value + (this._target.look - look.value) * k);
      lift.hold(lift.value + (this._target.lift - lift.value) * k);
    }
  }

  customElements.define(TAG, AgentEye);
}
