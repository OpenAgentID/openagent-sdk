/** Original seasonal bodies. Face geometry is supplied only by the shared live eyes. */
import type { CharacterArt, CharacterArtFamily, CharacterArtNode } from './character-art-types.js';

type Tag = 'g' | 'path' | 'ellipse' | 'rect' | 'defs' | 'linearGradient' | 'stop';
type Attributes = Readonly<Record<string, string | number>>;
type Stops = readonly (readonly [number, string])[];
const node = (tag: Tag, attributes: Attributes = {}, children: readonly CharacterArtNode[] = []): CharacterArtNode =>
  Object.freeze({ tag, attributes: Object.freeze(Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, String(value)]))),
    ...(children.length ? { children: Object.freeze([...children]) } : {}) });
const path = (d: string, fill: string, attributes: Attributes = {}): CharacterArtNode => node('path', { d, fill, ...attributes });
const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, attributes: Attributes = {}): CharacterArtNode =>
  node('ellipse', { cx, cy, rx, ry, fill, ...attributes });
const rect = (x: number, y: number, width: number, height: number, rx: number, fill: string): CharacterArtNode =>
  node('rect', { x, y, width, height, rx, fill });
const paint = (key: string): string => `url(#${key}-__INSTANCE__-body)`;
const gradient = (key: string, stops: Stops, coordinates: readonly [number, number, number, number] = [70, 40, 250, 380]): CharacterArtNode =>
  node('linearGradient', { id: `${key}-__INSTANCE__-body`, x1: coordinates[0], y1: coordinates[1],
    x2: coordinates[2], y2: coordinates[3], gradientUnits: 'userSpaceOnUse' },
  stops.map(([offset, color]) => node('stop', { offset, 'stop-color': color })));
const material = (key: string, a: string, b: string, c: string): CharacterArtNode => gradient(key, [[0, a], [0.6, b], [1, c]]);
const art = (color: string, y: number, scale: number, crop: readonly [number, number, number], definitions: readonly CharacterArtNode[],
  shapes: readonly CharacterArtNode[]): CharacterArt => Object.freeze({
    color, body: node('g', {}, [node('defs', {}, definitions), ...shapes]),
    face: Object.freeze({ x: 160, y, scale }), crop: Object.freeze({ x: crop[0], y: crop[1], size: crop[2] }),
  });
const family = (label: string, color: string, shapes: Readonly<Record<string, CharacterArt>>): CharacterArtFamily =>
  Object.freeze({ label, color, shapes: Object.freeze({ ...shapes }) });

const pumpkin = art('#E57324', 153, 0.6, [35, 50, 250],
  [material('halloween-pumpkin', '#FFAA43', '#E57324', '#CE571B')], [
    path('M145 87C145 65 149 45 164 30L180 34C166 50 166 66 170 88Z', '#18834C'),
    path('M171 73C198 46 226 51 239 71C209 87 186 84 171 73Z', '#70C948'),
    ellipse(112, 203, 63, 120, '#F48B28'), ellipse(207, 203, 63, 120, '#F48B28'),
    ellipse(160, 207, 80, 130, paint('halloween-pumpkin')),
    path('M111 100C93 169 100 279 127 322M209 100C226 167 223 275 196 322', 'none',
      { stroke: '#B74A1B', 'stroke-opacity': 0.35, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    path('M87 146C80 182 81 230 91 265', 'none',
      { stroke: '#FFD471', 'stroke-opacity': 0.5, 'stroke-width': 5, 'stroke-linecap': 'round' }),
  ]);

// The upper sheet is moonlit blue, not a second facial feature or black-eye substitution.
const ghost = art('#398ADA', 132, 0.6, [40, 30, 240],
  [material('halloween-ghost', '#398ADA', '#79BCEE', '#DDF3FF')], [
    path('M160 43C211 43 244 81 242 132C240 160 257 182 275 199C285 211 279 234 260 234C246 234 235 221 228 215L237 316C240 338 228 364 214 364C201 364 193 345 181 347C169 349 168 378 152 376C136 375 139 350 124 350C110 350 100 368 86 361C72 354 73 327 79 303L88 214C76 224 67 233 55 230C37 226 36 208 48 196C72 174 80 155 79 129C77 79 109 43 160 43Z', paint('halloween-ghost')),
    path('M101 235C92 272 93 316 94 341M217 240C224 281 221 321 212 346', 'none',
      { stroke: '#EFFAFF', 'stroke-opacity': 0.4, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    path('M94 114C96 86 109 69 128 61', 'none',
      { stroke: '#B7E6FF', 'stroke-opacity': 0.38, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

const bat = art('#7650BC', 135, 0.63, [35, 43, 250],
  [material('halloween-bat', '#7650BC', '#4B368B', '#9564DC')], [
    path('M99 170C77 166 54 149 38 124C37 165 44 197 62 215C74 206 83 213 90 234C101 217 111 226 120 250L140 200Z', '#8658C7'),
    path('M221 170C243 166 266 149 282 124C283 165 276 197 258 215C246 206 237 213 230 234C219 217 209 226 200 250L180 200Z', '#8658C7'),
    path('M51 160C67 180 93 182 118 195M269 160C253 180 227 182 202 195', 'none',
      { stroke: '#B78BF1', 'stroke-opacity': 0.55, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    path('M100 86L96 34C124 36 139 59 143 83M220 86L224 34C196 36 181 59 177 83', paint('halloween-bat')),
    ellipse(160, 140, 75, 82, paint('halloween-bat')),
    path('M119 200C105 236 117 281 141 305L152 327L160 315L170 328L181 306C205 279 215 238 201 200Z', paint('halloween-bat')),
    path('M108 66L105 47C117 50 125 60 129 74M212 66L215 47C203 50 195 60 191 74', '#D6A9FF'),
  ]);

const witchHat = art('#8051C7', 165, 0.6, [35, 75, 250],
  [material('halloween-witch-hat', '#8051C7', '#57348F', '#A371E6')], [
    path('M204 267C226 287 231 318 217 347L206 365L188 357C206 326 205 301 186 281Z', '#E8992A'),
    ellipse(160, 258, 124, 31, '#5B3793'),
    path('M80 249C97 207 103 180 109 149C108 109 123 62 153 34C174 18 212 43 238 50C213 56 198 73 195 98C229 140 223 190 242 248C209 265 115 265 80 249Z', paint('halloween-witch-hat')),
    path('M88 227C132 242 190 242 231 228L242 248C205 268 113 269 80 249Z', '#F4B432'),
    rect(144, 234, 32, 28, 5, '#FFE177'), rect(152, 240, 16, 16, 3, '#7545B4'),
    path('M119 121C129 80 142 59 154 50', 'none',
      { stroke: '#C9A0F7', 'stroke-opacity': 0.5, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

const candyCorn = art('#EC7725', 158, 0.62, [49, 70, 222],
  [gradient('halloween-candy-corn', [[0, '#FFF0BD'], [0.2, '#FFF0BD'], [0.2, '#EC7725'], [0.64, '#F7952D'],
    [0.64, '#FFD04C'], [1, '#DEAB24']], [160, 40, 160, 348])], [
    path('M160 37C180 37 194 63 207 88L271 286C285 318 264 343 233 346L87 346C54 343 36 318 49 286L113 88C126 63 140 37 160 37Z', paint('halloween-candy-corn')),
    path('M120 88L65 282C61 297 61 307 65 316', 'none',
      { stroke: '#FFF4C9', 'stroke-opacity': 0.36, 'stroke-width': 5, 'stroke-linecap': 'round' }),
  ]);

const turkey = art('#B87842', 133, 0.63, [38, 40, 244],
  [material('thanksgiving-turkey', '#B87842', '#8B4E2D', '#D49754')], [
    ellipse(160, 223, 31, 91, '#DA7440', { transform: 'rotate(-52 160 274)' }),
    ellipse(160, 205, 33, 111, '#F2A43C', { transform: 'rotate(-26 160 270)' }),
    ellipse(160, 186, 34, 128, '#FFD052'),
    ellipse(160, 205, 33, 111, '#F2A43C', { transform: 'rotate(26 160 270)' }),
    ellipse(160, 223, 31, 91, '#DA7440', { transform: 'rotate(52 160 274)' }),
    path('M124 337L123 363L105 371L131 371L146 359M196 337L197 363L215 371L189 371L174 359', 'none',
      { stroke: '#E8AF3D', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ellipse(160, 270, 76, 83, paint('thanksgiving-turkey')),
    ellipse(160, 133, 76, 79, paint('thanksgiving-turkey')),
    path('M103 254C106 283 118 303 133 314M217 254C214 283 202 303 187 314', 'none',
      { stroke: '#F6BF75', 'stroke-opacity': 0.37, 'stroke-width': 5, 'stroke-linecap': 'round' }),
  ]);

const acorn = art('#D89942', 161, 0.72, [38, 49, 244],
  [material('thanksgiving-acorn', '#D89942', '#AF6C28', '#F1BA5D')], [
    path('M150 52C150 39 157 28 171 26L177 38C165 40 163 48 164 57Z', '#8F552B'),
    path('M79 95C72 164 88 276 128 337C139 354 153 368 160 373C172 365 185 352 195 336C231 276 247 165 241 95Z', paint('thanksgiving-acorn')),
    path('M64 91C68 56 106 34 160 34C215 34 253 56 256 91L248 116C216 131 104 131 72 116Z', '#995D2D'),
    path('M90 76L111 111M117 57L151 117M154 49L190 113M190 53L220 100M91 106L130 57M121 119L169 49M160 121L206 58M199 116L233 79', 'none',
      { stroke: '#DAA35C', 'stroke-opacity': 0.5, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    path('M97 172C98 239 114 298 139 337', 'none',
      { stroke: '#FFE093', 'stroke-opacity': 0.35, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

const squash = art('#D8A02B', 135, 0.65, [42, 39, 236],
  [material('thanksgiving-squash', '#D8A02B', '#B0771B', '#F3C347')], [
    path('M148 64C143 44 151 31 167 27L179 35C163 40 165 51 171 64Z', '#329C52'),
    path('M159 54C210 52 240 82 239 124C238 163 209 190 208 223C207 249 239 258 255 287C278 331 246 366 199 374C174 379 146 379 121 373C73 363 45 326 69 285C85 257 112 247 112 220C112 191 84 163 82 124C80 81 111 56 159 54Z', paint('thanksgiving-squash')),
    path('M87 282C73 308 83 337 110 350M217 261C235 286 245 310 232 334', 'none',
      { stroke: '#FFE089', 'stroke-opacity': 0.36, 'stroke-width': 5, 'stroke-linecap': 'round' }),
    path('M105 111C106 92 116 77 131 70', 'none',
      { stroke: '#FFD975', 'stroke-opacity': 0.42, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

const pie = art('#E38A38', 187, 0.6, [36, 72, 248],
  [material('thanksgiving-pie', '#E38A38', '#BF5D24', '#F5AF54')], [
    ellipse(160, 301, 122, 20, '#4F9ECD'), ellipse(160, 294, 116, 15, '#B8E2F2'),
    path('M70 106L84 267C92 296 229 296 236 267L250 106Z', paint('thanksgiving-pie')),
    ellipse(160, 99, 94, 43, '#EEAA4B'),
    path('M62 109C60 96 73 89 82 96C85 81 100 79 111 89C118 75 133 75 142 86C153 71 168 71 178 85C189 73 205 78 211 91C225 81 239 88 240 101C255 100 262 111 256 123C241 135 226 124 216 130C202 139 187 130 177 133C165 138 154 136 143 133C130 139 115 129 104 133C88 137 76 126 67 127Z', '#FFD079'),
    path('M84 259C120 275 199 275 236 259L236 276C201 300 120 300 85 276Z', '#F4BB63'),
    path('M94 273L102 284M116 280L120 291M141 283L143 294M165 284L165 295M189 282L187 293M213 278L208 290M231 273L224 285', 'none',
      { stroke: '#BE802A', 'stroke-width': 3, 'stroke-linecap': 'round' }),
  ]);

const cornKernels: readonly CharacterArtNode[] = Object.freeze([192, 218, 244, 270, 296].flatMap((y, row) =>
  [112, 136, 160, 184, 208].map((x, column) => rect(x - 10, y - 10, 20, 22, 7,
    (row + column) % 3 === 0 ? '#E9AD22' : '#CE920D'))));
const corn = art('#C9900E', 135, 0.62, [48, 38, 224],
  [material('thanksgiving-corn', '#C9900E', '#AE750B', '#E5B322')], [
    path('M94 219C60 194 44 165 45 138C82 159 106 199 118 251L116 352C68 336 57 277 94 219Z', '#30AD59'),
    path('M226 219C260 194 276 165 275 138C238 159 214 199 202 251L204 352C252 336 263 277 226 219Z', '#55C66C'),
    path('M160 49C200 49 226 92 225 138L219 285C214 327 193 352 160 355C126 351 106 326 101 285L95 138C94 91 120 50 160 49Z', paint('thanksgiving-corn')),
    ...cornKernels,
    path('M78 225C91 265 111 313 160 365C109 354 76 317 64 278C58 254 65 237 78 225Z', '#80D86B'),
    path('M242 225C229 265 209 313 160 365C211 354 244 317 256 278C262 254 255 237 242 225Z', '#208B50'),
    path('M98 72C111 55 120 42 132 33M135 62C144 43 154 30 168 26M178 61C186 43 196 35 209 33', 'none',
      { stroke: '#FFDB62', 'stroke-width': 3, 'stroke-linecap': 'round' }),
  ]);

const light = art('#E94555', 148, 0.6, [48, 37, 224],
  [material('christmas-light', '#E94555', '#BF2E49', '#FA7984')], [
    path('M77 32C109 30 136 45 160 45C185 45 204 32 239 32', 'none',
      { stroke: '#278C58', 'stroke-width': 7, 'stroke-linecap': 'round' }),
    rect(124, 39, 72, 40, 12, '#167348'),
    path('M135 57L185 57M137 69L183 69', 'none', { stroke: '#73CA87', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    path('M130 76C87 84 68 113 71 157C77 226 119 281 144 330C150 343 155 353 160 358C166 352 171 341 177 329C204 278 245 226 249 157C252 111 232 83 190 76Z', paint('christmas-light')),
    path('M225 113C238 156 225 205 204 241', 'none',
      { stroke: '#FFC2BC', 'stroke-opacity': 0.7, 'stroke-width': 6, 'stroke-linecap': 'round' }),
    path('M87 141C87 118 97 101 108 95', 'none',
      { stroke: '#FF9A9F', 'stroke-opacity': 0.65, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

const tree = art('#1AA05E', 151, 0.6, [42, 47, 236],
  [material('christmas-tree', '#1AA05E', '#117747', '#46C67A')], [
    rect(137, 304, 46, 71, 10, '#B97934'),
    path('M160 42L241 139C252 151 242 159 225 159L211 159L265 220C279 235 262 243 244 244L226 244L279 308C291 325 277 337 258 339L62 339C43 337 29 325 41 308L94 244L76 244C58 243 41 235 55 220L109 159L95 159C78 159 68 151 79 139Z', paint('christmas-tree')),
    path('M84 229C124 246 192 247 238 231M60 315C114 335 203 336 263 315', 'none',
      { stroke: '#8AE199', 'stroke-opacity': 0.45, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    path('M160 26L166 39L181 41L170 52L173 67L160 60L147 67L150 52L139 41L154 39Z', '#FFD14C'),
    ellipse(103, 277, 8, 10, '#F15C4A'), ellipse(211, 289, 8, 10, '#FFDA62'),
    ellipse(157, 237, 7, 9, '#F15C4A'),
  ]);

const snowman = art('#3487C9', 120, 0.6, [57, 26, 206],
  [material('christmas-snowman', '#3487C9', '#65ADE0', '#B1DEF3')], [
    ellipse(160, 295, 96, 83, '#E3F4FF'), ellipse(160, 226, 78, 67, '#F1FAFF'),
    ellipse(160, 120, 83, 78, '#F5FCFF'), ellipse(160, 120, 76, 71, paint('christmas-snowman')),
    path('M98 184C135 196 188 198 222 181L224 202C185 219 132 216 95 204Z', '#E74745'),
    path('M202 200L225 205L237 274C228 286 209 285 208 277Z', '#F96B61'),
    path('M214 259L230 256M215 270L232 267', 'none', { stroke: '#FFB2A0', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    path('M84 211L50 189M236 211L270 189', 'none', { stroke: '#B57A42', 'stroke-width': 7, 'stroke-linecap': 'round' }),
    rect(101, 28, 118, 40, 12, '#228455'), rect(82, 62, 156, 17, 8, '#39AD70'),
    path('M103 276C92 305 99 338 119 354', 'none', { stroke: '#FFFFFF', 'stroke-width': 5, 'stroke-linecap': 'round' }),
  ]);

const ornament = art('#7852D4', 148, 0.6, [38, 35, 244],
  [material('christmas-ornament', '#7852D4', '#513EB0', '#9B78ED')], [
    ellipse(160, 41, 15, 14, 'none', { stroke: '#FFD364', 'stroke-width': 5 }),
    rect(130, 53, 60, 29, 8, '#E7B344'),
    ellipse(160, 188, 106, 121, paint('christmas-ornament')),
    path('M76 166C77 120 104 90 133 84', 'none',
      { stroke: '#D8BBFF', 'stroke-opacity': 0.64, 'stroke-width': 5, 'stroke-linecap': 'round' }),
    path('M73 238C118 269 208 274 250 241', 'none',
      { stroke: '#FFE49A', 'stroke-opacity': 0.68, 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
    path('M94 278C130 299 191 303 225 282', 'none',
      { stroke: '#FFE49A', 'stroke-opacity': 0.5, 'stroke-width': 3, 'stroke-linecap': 'round' }),
  ]);

const gift = art('#199C77', 144, 0.68, [41, 35, 238],
  [material('christmas-gift', '#199C77', '#0E7656', '#42C69D')], [
    path('M153 79C115 82 91 58 101 40C111 19 147 38 160 73C173 38 207 21 220 41C232 61 205 84 167 79Z', '#EE515D'),
    path('M117 43C124 42 144 55 153 73C132 71 114 56 117 43M202 44C192 46 177 58 168 73C191 70 207 56 202 44', '#FF8F96'),
    rect(73, 95, 174, 243, 17, paint('christmas-gift')),
    rect(64, 78, 192, 34, 11, '#28AE86'),
    rect(148, 218, 24, 120, 0, '#F16C65'), rect(73, 243, 174, 24, 0, '#F16C65'),
    path('M85 134L85 213', 'none', { stroke: '#8BE8B3', 'stroke-opacity': 0.58, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    path('M239 284L239 321C239 326 236 329 229 329L186 329', 'none',
      { stroke: '#09634E', 'stroke-opacity': 0.5, 'stroke-width': 4, 'stroke-linecap': 'round' }),
  ]);

export const seasonalArt: Readonly<Record<string, CharacterArtFamily>> = Object.freeze({
  halloween: family('Halloween', '#E57324', { pumpkin, ghost, bat, 'witch-hat': witchHat, 'candy-corn': candyCorn }),
  thanksgiving: family('Thanksgiving', '#C9900E', { turkey, acorn, squash, pie, corn }),
  christmas: family('Christmas', '#1AA05E', { light, tree, snowman, ornament, gift }),
});
