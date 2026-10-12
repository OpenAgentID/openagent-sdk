/** Package-owned head attachment anchors; independent of gaze and expression. */
import type { CharacterSkin, CharacterShape } from './characters.js';

export interface CharacterHead {
  /** Visible left/right head boundary at sideY, in the world 512-coordinate space. */
  readonly left: number;
  readonly right: number;
  /** Top of the face-bearing head core, excluding separate decorative appendages. */
  readonly top: number;
  readonly sideY: number;
}

const head = (left: number, right: number, top: number, sideY: number): CharacterHead =>
  Object.freeze({ left, right, top, sideY });
const family = (value: Readonly<Record<string, CharacterHead>>): Readonly<Record<string, CharacterHead>> =>
  Object.freeze({ ...value });

// Curated against the package SVG contours at their existing face y. Curves use
// horizontal contour intersections, rather than a full body bounding box. The
// 320x400 art stage maps through x=64+1.2*x, y=16+1.2*y; legacy bodies already use
// world coordinates. Painted outer strokes are included where the core has one.
const anchors: Readonly<Record<string, Readonly<Record<string, CharacterHead>>>> = Object.freeze({
  autos: family({
    standard: head(156, 356, 64, 168),
    slender: head(168, 344, 48, 152),
    wide: head(144, 368, 80, 190),
  }),
  spacex: family({
    circle: head(88.191, 423.809, 88, 264),
    pebble: head(79.186, 432.814, 115.007, 264),
    squircle: head(104, 408, 104, 264),
    capsule: head(88, 424, 144, 264),
    triangle: head(137.374, 374.626, 88, 264),
    hexagon: head(76.5, 435.5, 112, 264),
    cloud: head(99.098, 404.74, 106.312, 264),
    droplet: head(100.6, 411.4, 84, 264),
  }),
  // Fold silhouettes use the outer folded-paper contour, not interior facets.
  fold: family({
    standard: head(144.903, 370.674, 51.1, 166),
    kite: head(152.226, 371.636, 54.4, 166),
    fan: head(158.37, 353.44, 74.8, 166),
  }),
  // Leaf sprouts and low stem leaves are decoration; use the face-bearing leaf/bud.
  sprig: family({
    standard: head(151.559, 370.526, 87.33, 166),
    bud: head(145.659, 368.137, 73.327, 166),
    leaf: head(138.456, 380.311, 57.331, 166),
  }),
  // The asymmetric outer wave/drop contour is intentional; do not mirror anchors.
  ripple: family({
    standard: head(153.045, 394.411, 72.472, 166),
    drop: head(150.639, 376.465, 50.8, 166),
    wave: head(141.466, 385.456, 53.712, 166),
  }),
  // Ignore halo rings, trailing tails and satellite panels; anchor the solid head.
  halo: family({
    standard: head(154, 358.198, 80.197, 166),
    comet: head(143.77, 367.205, 64.823, 166),
    satellite: head(155.017, 357.51, 64, 166),
  }),
  // Use the knit hood/mitt core contour, excluding hands, cuff and feet below the face.
  purl: family({
    standard: head(141.482, 364.875, 50.045, 166),
    mitt: head(148.817, 353.21, 52.832, 166),
    hood: head(147.974, 362.536, 49.6, 166),
  }),
  // Only the main faceted head; hands, shoulders and pedestal are not head width.
  prism: family({
    standard: head(145.033, 367.6, 49.6, 166),
    crystal: head(161.41, 352.686, 50.8, 166),
    obelisk: head(167.534, 344.466, 49.6, 166),
  }),
  // Head cap only; spring wire, spine, side knobs and foot are excluded.
  coil: family({
    standard: head(163.921, 359.697, 63.366, 166),
    spring: head(157.6, 355.99, 68.8, 166),
    bellows: head(147.502, 363.708, 58.525, 166),
  }),
  // Main clay chamber/neck; glaze, teapot spout/handle/lid knob are excluded.
  kiln: family({
    standard: head(162.455, 362.5, 53.601, 166),
    vase: head(168.53, 342.644, 58, 166),
    teapot: head(165.643, 350.874, 92.642, 166),
  }),
  // Use the face-bearing flame contour; lower curls are not attachment anchors.
  wisp: family({
    standard: head(151.764, 365.671, 47.564, 166),
    flame: head(147.242, 371.189, 49.6, 166),
    curl: head(145.301, 366.012, 61.943, 166),
  }),
  // Outer head housing, including the beacon roof; displays, antennae, hands and base are excluded.
  relay: family({
    standard: head(152.221, 357.947, 52.585, 166),
    radio: head(134.94, 377.534, 88, 166),
    beacon: head(171.97, 343.025, 50.8, 166),
  }),
  // Upper face-bearing stone, including the tower capstone; arms and lower stones are excluded.
  cairn: family({
    standard: head(162.13, 363.892, 60.001, 166),
    tower: head(149.06, 356.295, 47.462, 166),
    arch: head(150.79, 359.826, 58.359, 166),
  }),
  // Scalloped head core; bear ears, paws and pom tassels are separate appendages.
  tuft: family({
    standard: head(151.9, 363.722, 47.332, 166),
    pom: head(137.309, 377.089, 52.715, 166),
    bear: head(152.751, 360.602, 80.345, 166),
  }),
  // Pumpkin unions its three lobes; ghost excludes arms, bat excludes ears/wings. Hat uses its cone, not brim/ribbon.
  halloween: family({
    pumpkin: head(129.675, 381.125, 108.4, 199.6),
    ghost: head(158.89, 354.4, 67.6, 174.4),
    bat: head(166.167, 345.833, 85.6, 178),
    'witch-hat': head(190.952, 332.452, 50.496, 214),
    'candy-corn': head(172.448, 339.552, 60.4, 205.6),
  }),
  // Turkey uses its head, not fan/wings. Acorn includes its cap; pie includes pastry top. Stems/husks are excluded.
  thanksgiving: family({
    turkey: head(164.8, 347.2, 80.8, 175.6),
    acorn: head(158.261, 353.128, 56.8, 209.2),
    squash: head(163.909, 349.569, 80.687, 178),
    pie: head(156.452, 355.548, 83.2, 240.4),
    corn: head(177.967, 334.032, 74.8, 178),
  }),
  // Use bulb/tree/head sphere/bauble core, excluding wire/socket, star, hat or hanger. Gift includes lid, not bow.
  christmas: family({
    light: head(148.833, 363.152, 107.2, 193.6),
    tree: head(153.869, 358.131, 66.4, 197.2),
    snowman: head(156.4, 355.6, 66.4, 160),
    ornament: head(135.951, 376.049, 96.4, 193.6),
    gift: head(151.6, 360.4, 109.6, 188.8),
  }),
});

/** Exact family/kind lookup. Unknown or cross-family selectors never get a fallback. */
export function characterHead(skin: CharacterSkin, shape: CharacterShape): CharacterHead {
  const selected = typeof skin === 'string' && Object.hasOwn(anchors, skin) ? anchors[skin] : undefined;
  const result = selected && typeof shape === 'string' && Object.hasOwn(selected, shape) ? selected[shape] : undefined;
  if (!result) throw new RangeError('Unsupported character head shape');
  return result;
}
