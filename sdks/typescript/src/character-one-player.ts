/**
 * Browser rendering for One heads. Every One head in a window shares one stage: one
 * requestAnimationFrame ticker that runs only while a head moves, one IntersectionObserver, one
 * ResizeObserver and a calm director. Importing this module does not touch a DOM.
 *
 * Calm by rule (AVATARS.md §2.3): nothing moves at rest; a moment starts only for a head at least
 * 60 % in view while the page is not scrolling; one head moves per row group and at most three in
 * the window (two below 600 px wide); a moment that cannot start within 1.5 s is dropped and the head
 * shows its held face; hidden heads and hidden documents never tick. A head that follows the pointer
 * moves its eye only and is not counted.
 */
import { GEOMETRY } from './agent-eye.js';
import { oneKeylineWidth, onePaint, oneTier, type OneFace, type OneHeadColor, type OnePaint, type OneTheme } from './character-one.js';
import { OneMotion, type OneCadence, type OneMomentRequest, type OneMotionFrame } from './character-one-motion.js';

const SVG = 'http://www.w3.org/2000/svg';
const LIST_CONTAINERS = 'ul,ol,[role="list"],[role="listbox"],[role="grid"],[role="feed"],[role="tree"],table';
const INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** Pointer follow: within this many pixels of the head's edge, back to the held face this long after the pointer stops. */
const FOLLOW_RANGE = 240;
const FOLLOW_REST_MS = 1600;
const WASH_MS = 240;
const stages = new WeakMap<Window, OneStage>();

interface Queued { readonly head: OneHead; readonly request: OneMomentRequest; readonly at: number }

class OneStage {
  private readonly heads = new Set<OneHead>();
  private readonly byRoot = new WeakMap<Element, OneHead>();
  private readonly ticking = new Set<OneHead>();
  private readonly movers = new Set<OneHead>();
  private readonly waiting = new Set<OneHead>();
  private readonly followers = new Set<OneHead>();
  private queue: Queued[] = [];
  private raf = 0;
  private pumpTimer = 0;
  private scrollAt = -Infinity;
  inputAt: number;
  private readonly io: IntersectionObserver | null;
  private readonly ro: ResizeObserver | null;
  private readonly onScroll = (): void => { this.scrollAt = this.now(); this.input(); };
  private readonly onInput = (): void => this.input();
  private readonly onPointer = (event: Event): void => {
    this.input();
    const pointer = event as PointerEvent;
    if (pointer.pointerType && pointer.pointerType !== 'mouse') return;
    for (const head of this.followers) head.pointer(pointer.clientX, pointer.clientY);
  };
  private readonly onVisibility = (): void => this.visibilityChanged();

  constructor(private readonly win: Window) {
    this.inputAt = this.now();
    const IO = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    this.io = IO ? new IO(entries => {
      for (const entry of entries) {
        const head = this.headFor(entry.target);
        if (head) head.setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.6);
      }
    }, { threshold: [0, 0.6, 1] }) : null;
    const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    this.ro = RO ? new RO(entries => {
      for (const entry of entries) {
        const head = this.headFor(entry.target);
        if (head && entry.contentRect.width > 0) head.setRenderedSize(entry.contentRect.width);
      }
    }) : null;
  }

  static for(win: Window): OneStage {
    let stage = stages.get(win);
    if (!stage) { stage = new OneStage(win); stages.set(win, stage); }
    return stage;
  }

  now(): number { return this.win.performance.now(); }
  get hidden(): boolean { return this.win.document.hidden; }
  get reach(): number { return Math.max(this.win.innerWidth, this.win.innerHeight) * 0.4; }
  scrolling(): boolean { return this.now() - this.scrollAt < 200; }
  /** Viewer input keeps repeating cadences alive. */
  idle(): boolean { return this.now() - this.inputAt > 60_000; }

  private headFor(target: Element): OneHead | undefined { return this.byRoot.get(target); }

  add(head: OneHead): void {
    if (!this.heads.size) {
      const options = { capture: true, passive: true } as const;
      this.win.addEventListener('scroll', this.onScroll, options);
      this.win.addEventListener('pointermove', this.onPointer, options);
      for (const type of INPUTS) this.win.addEventListener(type, this.onInput, options);
      this.win.document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.heads.add(head);
    if (head.follows) this.followers.add(head);
    this.byRoot.set(head.root, head);
    if (this.io) this.io.observe(head.root); else head.setVisible(true);
    this.ro?.observe(head.root);
  }

  /** A head's root element is replaced when its paint changes: keep observing the new one. */
  replaced(previous: Element, head: OneHead): void {
    this.io?.unobserve(previous);
    this.ro?.unobserve(previous);
    this.byRoot.delete(previous);
    this.byRoot.set(head.root, head);
    if (this.io) this.io.observe(head.root);
    this.ro?.observe(head.root);
  }

  remove(head: OneHead): void {
    if (!this.heads.delete(head)) return;
    this.byRoot.delete(head.root);
    this.io?.unobserve(head.root);
    this.ro?.unobserve(head.root);
    this.ticking.delete(head);
    this.waiting.delete(head);
    this.followers.delete(head);
    this.queue = this.queue.filter(item => item.head !== head);
    this.release(head);
    if (!this.heads.size) {
      const options = { capture: true } as const;
      this.win.removeEventListener('scroll', this.onScroll, options);
      this.win.removeEventListener('pointermove', this.onPointer, options);
      for (const type of INPUTS) this.win.removeEventListener(type, this.onInput, options);
      this.win.document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.raf) this.win.cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.pumpTimer) this.win.clearTimeout(this.pumpTimer);
      this.pumpTimer = 0;
      stages.delete(this.win);
    }
  }

  private input(): void {
    const wasIdle = this.idle();
    this.inputAt = this.now();
    if (wasIdle && this.waiting.size) {
      const resumed = [...this.waiting];
      this.waiting.clear();
      for (const head of resumed) head.scheduleCadence();
    }
  }
  waitForInput(head: OneHead): void { this.waiting.add(head); }
  stopWaiting(head: OneHead): void { this.waiting.delete(head); }

  private cap(): number { return this.win.innerWidth > 0 && this.win.innerWidth < 600 ? 2 : 3; }
  private groupMover(head: OneHead): OneHead | undefined {
    for (const mover of this.movers) if (mover !== head && mover.group === head.group) return mover;
    return undefined;
  }
  private canStart(head: OneHead): boolean {
    return !this.hidden && !this.scrolling() && !this.groupMover(head) && this.movers.size < this.cap();
  }

  /** Ask for a moment. It starts now, waits for a slot, or is dropped after 1.5 s. */
  request(head: OneHead, request: OneMomentRequest): void {
    if (!head.motionAllowed || this.hidden) { head.snap(); return; }
    if (request.uncounted || request.user) { this.begin(head, request); return; }
    if (this.movers.has(head)) {
      const current = head.motion.request;
      if (current && !current.cadence && current.priority > request.priority) { this.enqueue(head, request); return; }
      this.begin(head, request);
      return;
    }
    const other = this.groupMover(head);
    if (other && other.motion.request?.cadence && request.priority >= 4) other.cutCadence();
    if (this.canStart(head)) { this.begin(head, request); return; }
    this.enqueue(head, request);
  }

  private begin(head: OneHead, request: OneMomentRequest): void {
    this.queue = this.queue.filter(item => item.head !== head);
    head.start(request, this.now());
    if (!request.uncounted) this.movers.add(head);
    this.tick(head);
  }

  private enqueue(head: OneHead, request: OneMomentRequest): void {
    this.queue = this.queue.filter(item => item.head !== head);
    this.queue.push({ head, request, at: this.now() });
    this.armPump();
  }

  private armPump(): void {
    if (!this.pumpTimer && this.queue.length) this.pumpTimer = this.win.setTimeout(() => { this.pumpTimer = 0; this.pump(); }, 100);
  }

  private pump(): void {
    const now = this.now();
    this.queue.sort((a, b) => b.request.priority - a.request.priority || a.at - b.at);
    const keep: Queued[] = [];
    for (const item of this.queue) {
      if (!item.head.visible || !item.head.motionAllowed) continue;
      // Missed is missed: the head shows its held face rather than performing late.
      if (now - item.at > 1500) { item.head.start({ name: 'settle', priority: 0, uncounted: true }, now); this.tick(item.head); continue; }
      if (this.canStart(item.head)) { this.begin(item.head, item.request); continue; }
      keep.push(item);
    }
    this.queue = keep;
    this.armPump();
  }

  release(head: OneHead): void {
    if (this.movers.delete(head) && this.queue.length) this.pump();
  }

  cancel(head: OneHead): void {
    this.queue = this.queue.filter(item => item.head !== head);
    this.ticking.delete(head);
    this.release(head);
  }

  /** Keep a moving head on the shared ticker. */
  tick(head: OneHead): void {
    this.ticking.add(head);
    if (!this.raf && !this.hidden) this.raf = this.win.requestAnimationFrame(() => this.frame());
  }

  private frame(): void {
    this.raf = 0;
    if (this.hidden) return;
    const now = this.now();
    const scrolling = this.scrolling();
    for (const head of [...this.ticking]) if (!head.step(now, scrolling)) this.ticking.delete(head);
    if (this.ticking.size) this.raf = this.win.requestAnimationFrame(() => this.frame());
  }

  private visibilityChanged(): void {
    if (this.hidden) {
      if (this.raf) this.win.cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.queue = [];
      for (const head of this.heads) head.hide();
      this.movers.clear();
      this.ticking.clear();
    } else {
      for (const head of this.heads) if (head.visible) head.show();
    }
  }
}

export interface OneHeadOptions {
  readonly kind: OneHeadColor;
  readonly theme: OneTheme;
  readonly size: number;
  readonly label?: string;
  readonly face: OneFace;
  readonly gaze: { readonly x: number; readonly y: number };
  readonly blink: number;
  readonly status: string;
  readonly expression: string;
  readonly speaking: boolean;
  readonly cadence: OneCadence;
  readonly voiceLevel?: () => number;
  readonly group?: string;
  /** Let the eye follow a fine pointer near the head (headers and heroes, 40 px and up). */
  readonly follow?: boolean;
  readonly reduced: boolean;
  readonly animated: boolean;
  readonly random: () => number;
}

const ui = (u: number): number => 1 - Math.pow(1 - u, 3);
function mix(from: string, to: string, u: number): string {
  const channel = (value: string, i: number): number => parseInt(value.slice(1 + 2 * i, 3 + 2 * i), 16);
  return '#' + [0, 1, 2].map(i => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * u).toString(16).padStart(2, '0')).join('');
}

/** One live head inside a host element. */
export class OneHead {
  root!: SVGSVGElement;
  readonly motion: OneMotion;
  readonly group: unknown;
  readonly follows: boolean;
  visible = false;
  private readonly stage: OneStage;
  private readonly doc: Document;
  private kind: OneHeadColor;
  private theme: OneTheme;
  private label: string | undefined;
  private px: number;
  private speaking: boolean;
  private seen: OneFace;
  private reduced: boolean;
  private readonly animated: boolean;
  private cadenceTimer = 0;
  private followTimer = 0;
  private disposed = false;
  private wash: { readonly from: OnePaint; readonly start: number } | null = null;
  private parts!: { disc: SVGElement; eye: SVGElement; bar: SVGElement; mouth: SVGElement; body: SVGElement; keyline: SVGElement | null };
  private written: Record<string, string> = {};
  private readonly instance: string;

  constructor(host: Element, options: OneHeadOptions) {
    this.doc = host.ownerDocument!;
    const win = this.doc.defaultView!;
    this.stage = OneStage.for(win);
    this.kind = options.kind;
    this.theme = options.theme;
    this.label = options.label;
    this.px = options.size;
    this.speaking = options.speaking;
    this.reduced = options.reduced;
    this.animated = options.animated;
    this.follows = options.follow === true;
    this.seen = options.face;
    this.instance = 'oaid-one-' + Array.from(win.crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16)).join('-');
    this.group = options.group ?? host.closest(LIST_CONTAINERS) ?? this;
    this.motion = new OneMotion({ face: options.face, gaze: options.gaze, px: this.px,
      temperament: onePaint(this.kind, this.theme).temperament, random: options.random, cadence: options.cadence,
      ...(options.voiceLevel ? { level: options.voiceLevel } : {}), motion: this.motionAllowed, at: this.stage.now() });
    this.motion.setBlink(options.blink);
    this.build();
    this.setStateAttributes(options.status, options.expression);
    // A still One rendered on the server for this element is replaced in place, so hydration never adds a second head.
    const still = Array.from(host.children).find(child => child.localName === 'svg' &&
      child.getAttribute('data-character-skin') === 'one' && !child.hasAttribute('data-character-player'));
    if (still) still.replaceWith(this.root); else host.append(this.root);
    this.stage.add(this);
  }

  get motionAllowed(): boolean { return !this.reduced && this.animated && !this.disposed; }

  private node(tag: string, attributes: Readonly<Record<string, string>> = {}): SVGElement {
    const element = this.doc.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  /** The head's DOM: 5–7 nodes, plus a mask for Digital One's knocked-out eye. Sets `root`. */
  private build(): void {
    const paint = onePaint(this.kind, this.theme);
    const root = this.node('svg', { xmlns: SVG, viewBox: '-100 -100 200 200', width: String(this.px), height: String(this.px),
      overflow: 'visible', 'data-character-player': 'agent-eye-v1', 'data-character-skin': 'one', 'data-character-version': '1',
      'data-character-shape': this.kind, 'data-character-theme': this.theme, 'data-one-color': this.kind }) as SVGSVGElement;
    if (this.label === undefined) { root.setAttribute('aria-hidden', 'true'); root.setAttribute('focusable', 'false'); }
    else {
      root.setAttribute('role', 'img');
      root.setAttribute('aria-label', this.label);
      const title = this.node('title');
      title.textContent = this.label;
      root.append(title);
    }
    const body = this.node('g', { 'data-character-body': 'true' });
    const disc = this.node('circle', { 'data-one-disc': 'true', r: String(GEOMETRY.radius), fill: paint.disc });
    const eye = this.node('g', { 'data-character-eyes': 'agent-eye-v1' });
    const ink = paint.eye ?? '#000000';
    const bar = this.node('path', { 'data-one-eye': 'true', fill: ink, stroke: ink, 'stroke-linejoin': 'round' });
    const mouth = this.node('rect', { 'data-one-mouth': 'true', fill: ink, display: 'none' });
    eye.append(bar);
    let keyline: SVGElement | null = null;
    if (paint.eye === null) {
      const mask = this.node('mask', { id: this.instance, maskUnits: 'userSpaceOnUse', x: '-100', y: '-100', width: '200', height: '200' });
      mask.append(this.node('rect', { x: '-100', y: '-100', width: '200', height: '200', fill: '#ffffff' }), eye, mouth);
      const defs = this.node('defs');
      defs.append(mask);
      root.append(defs);
      disc.setAttribute('mask', `url(#${this.instance})`);
      body.append(disc);
    } else {
      body.append(disc);
      if (paint.keyline !== null) {
        keyline = this.node('circle', { 'data-one-keyline': 'true', fill: 'none', stroke: paint.keyline });
        body.append(keyline);
      }
      body.append(eye, mouth);
    }
    root.append(body);
    this.root = root;
    this.parts = { disc, eye, bar, mouth, body, keyline };
    this.written = {};
    this.keyline();
    // Repaint without advancing time: a moment that ends now still finishes on the ticker and frees its slot.
    this.paint(this.motion.peek(this.stage.now()), true);
  }

  private keyline(): void {
    if (!this.parts.keyline) return;
    const width = oneKeylineWidth(this.px, this.doc.defaultView?.devicePixelRatio ?? 1);
    this.parts.keyline.setAttribute('r', String(Number((GEOMETRY.radius - width / 2).toFixed(4))));
    this.parts.keyline.setAttribute('stroke-width', String(Number(width.toFixed(4))));
  }

  private write(element: Element, key: string, attribute: string, value: string | null): void {
    if (this.written[key] === (value ?? '\u0000')) return;
    this.written[key] = value ?? '\u0000';
    if (value === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, value);
  }

  /** At most a few diffed attribute writes per frame; no layout reads. */
  private paint(frame: OneMotionFrame, force = false): void {
    if (force) this.written = {};
    const { geometry } = frame;
    this.write(this.parts.eye, 'eye', 'transform', geometry.eye);
    this.write(this.parts.bar, 'bar', 'd', geometry.bar);
    this.write(this.parts.bar, 'stroke', 'stroke-width', String(geometry.strokeWidth));
    this.write(this.parts.mouth, 'mouth', 'display', geometry.mouth ? 'inline' : 'none');
    if (geometry.mouth) {
      for (const key of ['x', 'y', 'width', 'height', 'rx', 'opacity'] as const) this.write(this.parts.mouth, `mouth-${key}`, key, String(geometry.mouth[key]));
    }
    this.write(this.parts.body, 'body', 'transform', geometry.body || null);
    this.write(this.root, 'face', 'data-one-face', frame.face);
    this.write(this.root, 'tier', 'data-one-tier', frame.tier);
    this.paintColour();
  }

  /** The disc's colour: a blank head's tint, the colour itself, or the First blink wash between them. */
  private paintColour(): void {
    const paint = onePaint(this.kind, this.theme);
    const wash = this.wash;
    const u = wash ? ui(Math.min(1, Math.max(0, (this.stage.now() - wash.start) / WASH_MS))) : 1;
    if (wash && u >= 1) this.wash = null;
    const from = wash && u < 1 ? wash.from : paint;
    const opacity = from.discOpacity + (paint.discOpacity - from.discOpacity) * u;
    this.write(this.parts.disc, 'disc', 'fill', mix(from.disc, paint.disc, u));
    this.write(this.parts.disc, 'disc-opacity', 'fill-opacity', opacity >= 1 ? null : String(Number(opacity.toFixed(3))));
    if (this.parts.keyline) this.write(this.parts.keyline, 'keyline', 'stroke-opacity', u >= 1 ? null : String(Number(u.toFixed(3))));
    if (paint.eye !== null) {
      const ink = from.eye === null ? paint.eye : mix(from.eye, paint.eye, u);
      this.write(this.parts.bar, 'ink', 'fill', ink);
      this.write(this.parts.bar, 'ink-stroke', 'stroke', ink);
      this.write(this.parts.mouth, 'mouth-ink', 'fill', ink);
    }
  }

  private setStateAttributes(status: string, expression: string): void {
    this.root.setAttribute('data-character-status', status);
    this.root.setAttribute('data-character-expression', expression);
  }

  /** Apply a resolved runtime state. */
  setState(face: OneFace, gaze: { readonly x: number; readonly y: number }, blink: number, status: string, expression: string): void {
    if (this.disposed) return;
    this.setStateAttributes(status, expression);
    this.speaking = status === 'speaking';
    this.motion.setBlink(blink);
    this.motion.noteInput(this.stage.inputAt);
    const request = this.motion.setFace(face, gaze, this.stage.now());
    if (!request) {
      if (!this.motion.moving) this.paint(this.motion.sample(this.stage.now()).frame);
      if (this.speaking) this.startTalk();
      return;
    }
    this.stopCadence();
    this.stopFollow();
    // Since you looked: a hidden head records the change and performs it when it comes into view.
    if (!this.visible || this.stage.hidden) { this.motion.snap(); this.paint(this.motion.sample(this.stage.now()).frame); return; }
    this.seen = face;
    this.stage.request(this, request);
  }

  start(request: OneMomentRequest, at: number): void {
    this.motion.start(request, at);
    this.root.setAttribute('data-moving', '');
  }

  /** One ticker step; returns whether the head is still moving. */
  step(at: number, scrolling: boolean): boolean {
    const playing = this.motion.timelineEnd !== null;
    const { frame, finished } = this.motion.sample(at);
    // While a list scrolls, a playing moment advances without writing geometry.
    if (!scrolling || !playing || finished) this.paint(frame);
    if (finished) {
      this.stage.release(this);
      if (this.speaking) this.startTalk();
      else this.scheduleCadence();
    }
    const moving = this.motion.moving || this.wash !== null;
    if (!moving) this.root.removeAttribute('data-moving');
    return moving;
  }

  private startTalk(): void {
    if (this.visible && this.motion.startTalk(this.stage.now())) {
      this.root.setAttribute('data-moving', '');
      this.stage.tick(this);
    }
  }

  /** The window's pointer moved: follow it with the eye when it is near, rest 1.6 s after it stops. */
  pointer(x: number, y: number): void {
    if (!this.visible || !this.motionAllowed || this.stage.hidden) return;
    const current = this.motion.request;
    if (current && !current.uncounted) return;
    const tier = oneTier(this.px);
    if (tier !== 'M' && tier !== 'L') return;
    const box = this.root.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    if (Math.hypot(x - cx, y - cy) > FOLLOW_RANGE + box.width / 2) { if (this.motion.following) this.endFollow(); return; }
    const reach = this.stage.reach;
    if (!this.motion.follow({ x: Math.tanh((x - cx) / reach * 1.4), y: Math.tanh((y - cy) / reach * 1.4) })) return;
    this.root.setAttribute('data-moving', '');
    this.stage.tick(this);
    const win = this.doc.defaultView!;
    if (this.followTimer) win.clearTimeout(this.followTimer);
    this.followTimer = win.setTimeout(() => { this.followTimer = 0; this.endFollow(); }, FOLLOW_REST_MS);
  }

  private endFollow(): void {
    this.stopFollow();
    if (this.visible && this.motionAllowed) this.stage.request(this, { name: 'home', priority: 0, uncounted: true });
  }

  private stopFollow(): void {
    if (this.followTimer) this.doc.defaultView?.clearTimeout(this.followTimer);
    this.followTimer = 0;
    this.motion.follow(null);
  }

  /** Ongoing work moves briefly in lists and in clusters in headers; nothing is scheduled at rest. */
  scheduleCadence(): void {
    this.stopCadence();
    if (!this.visible || !this.motionAllowed || this.stage.hidden) return;
    this.motion.noteInput(this.stage.inputAt);
    const now = this.stage.now();
    const delay = this.motion.nextCadence(now);
    if (delay === null) {
      if (this.motion.cadenceRequest() && this.stage.idle()) this.stage.waitForInput(this);
      return;
    }
    this.cadenceTimer = this.doc.defaultView!.setTimeout(() => {
      this.cadenceTimer = 0;
      const request = this.motion.cadenceRequest();
      if (request && this.visible) this.stage.request(this, request);
    }, delay);
  }

  private stopCadence(): void {
    if (this.cadenceTimer) this.doc.defaultView?.clearTimeout(this.cadenceTimer);
    this.cadenceTimer = 0;
    this.stage.stopWaiting(this);
  }

  /** A higher-priority entrance in the same group ends an ongoing cadence early. */
  cutCadence(): void {
    this.stage.cancel(this);
    this.start({ name: 'settle', priority: 0, uncounted: true }, this.stage.now());
    this.stage.tick(this);
  }

  /** Hold the face still, ending any motion. */
  snap(): void {
    this.stopCadence();
    this.stopFollow();
    this.stage.cancel(this);
    this.motion.snap();
    this.wash = null;
    this.root.removeAttribute('data-moving');
    this.paint(this.motion.sample(this.stage.now()).frame, true);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.show(); else this.hide();
  }

  show(): void {
    if (this.disposed || this.stage.hidden) return;
    if (!this.motionAllowed) { this.snap(); this.seen = this.motion.face; return; }
    const face = this.motion.face;
    if (this.seen !== face) {
      const previous = this.seen;
      this.seen = face;
      this.stage.request(this, this.motion.entrance(previous, face));
      return;
    }
    if (this.speaking) { this.startTalk(); return; }
    const cadence = this.motion.cadenceRequest();
    if (cadence) {
      this.motion.restartWindow(this.stage.now());
      this.stage.request(this, { ...cadence, priority: 1 });
    }
  }

  hide(): void {
    this.stopCadence();
    if (this.motion.moving || this.wash) this.snap();
    else this.stage.cancel(this);
  }

  setRenderedSize(px: number): void {
    const rounded = Math.round(px);
    if (!Number.isFinite(rounded) || rounded <= 0 || rounded === this.px) return;
    const tier = oneTier(this.px) !== oneTier(rounded);
    this.px = rounded;
    this.motion.setSize(rounded);
    this.keyline();
    if (tier && !this.motion.moving) this.paint(this.motion.sample(this.stage.now()).frame);
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    this.motion.setMotion(this.motionAllowed);
    if (!this.motionAllowed) this.snap();
    else if (this.visible) { this.seen = this.motion.face; this.show(); }
  }

  /**
   * Recolour, change surface, size or name. A new colour waves at 40 px and up; a blank head that is given a
   * colour plays First blink instead (its disc washes to the colour while the eye opens for the first time).
   */
  setPaint(kind: OneHeadColor, theme: OneTheme, size: number, label: string | undefined): void {
    const recolour = kind !== this.kind;
    if (kind === this.kind && theme === this.theme && label === this.label) {
      if (size !== this.px) { this.root.setAttribute('width', String(size)); this.root.setAttribute('height', String(size)); this.setRenderedSize(size); }
      return;
    }
    const before = onePaint(this.kind, this.theme);
    const firstBlink = this.kind === 'blank' && kind !== 'blank';
    this.kind = kind;
    this.theme = theme;
    this.label = label;
    this.px = size;
    this.motion.setSize(size);
    this.motion.setTemperament(onePaint(kind, theme).temperament);
    const previous = this.root;
    this.build();
    for (const name of ['data-character-status', 'data-character-expression', 'data-moving'] as const) {
      const value = previous.getAttribute(name);
      if (value !== null) this.root.setAttribute(name, value);
    }
    previous.replaceWith(this.root);
    this.stage.replaced(previous, this);
    if (!recolour || !this.visible || !this.motionAllowed) return;
    if (firstBlink && this.motion.tier !== 'XS') {
      this.wash = { from: before, start: this.stage.now() };
      this.paintColour();
      this.stage.request(this, { name: 'firstBlink', priority: 7, user: true });
    } else if (this.motion.tier === 'M' || this.motion.tier === 'L') {
      this.stage.request(this, { name: 'wave', priority: 4, user: true });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopCadence();
    this.stopFollow();
    this.stage.remove(this);
    this.root.remove();
  }
}
