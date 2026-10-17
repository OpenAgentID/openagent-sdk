/**
 * Browser rendering for One heads. Every One head in a window shares one stage: one
 * requestAnimationFrame ticker that runs only while a head moves, one IntersectionObserver, one
 * ResizeObserver and a calm director. Importing this module does not touch a DOM.
 *
 * Calm by rule (AVATARS.md §2.3): nothing moves at rest; a moment starts only for a head at least
 * 60 % in view while the page is not scrolling; one head moves per row group and at most three in
 * the window (two below 600 px wide); a moment that cannot start within 1.5 s is dropped and the head
 * shows its held face at once; hidden heads and hidden documents never tick. A head that follows the
 * pointer moves its eye only and is not counted.
 */
import { oneInsetPath, oneKeylineWidth, onePaint, oneRimWidth, oneShapeGeometry, oneShapeId, oneTier,
  type OneFace, type OneHeadColor, type OneKind, type OnePaint, type OneTheme } from './character-one.js';
import { OneMotion, type OneCadence, type OneGesture, type OneMomentRequest, type OneMotionFrame } from './character-one-motion.js';

const SVG = 'http://www.w3.org/2000/svg';
const LIST_CONTAINERS = 'ul,ol,[role="list"],[role="listbox"],[role="grid"],[role="feed"],[role="tree"],table';
const INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** Pointer follow: within this many pixels of the head's edge, back to the held face this long after the pointer stops. */
const FOLLOW_RANGE = 240;
const FOLLOW_REST_MS = 1600;
const WASH_MS = 240;
/** A gesture asked of a head that is not yet in view (an arrival on mount) plays when it is, within this long. */
const GESTURE_WAIT_MS = 1500;
const stages = new WeakMap<Window, OneStage>();

interface Queued { readonly head: OneHead; readonly request: OneMomentRequest; readonly at: number }

class OneStage {
  private readonly _oneHeads = new Set<OneHead>();
  private readonly _oneByRoot = new WeakMap<Element, OneHead>();
  private readonly _oneTicking = new Set<OneHead>();
  private readonly _oneMovers = new Set<OneHead>();
  private readonly _oneWaiting = new Set<OneHead>();
  private readonly _oneFollowers = new Set<OneHead>();
  private _oneQueue: Queued[] = [];
  private _oneRaf = 0;
  private _onePumpTimer = 0;
  private _oneScrollAt = -Infinity;
  inputAt: number;
  private readonly _oneIo: IntersectionObserver | null;
  private readonly _oneRo: ResizeObserver | null;
  private readonly _oneOnScroll = (): void => { this._oneScrollAt = this.now(); this._oneInput(); };
  private readonly _oneOnInput = (): void => this._oneInput();
  private readonly _oneOnPointer = (event: Event): void => {
    this._oneInput();
    const pointer = event as PointerEvent;
    if (pointer.pointerType && pointer.pointerType !== 'mouse') return;
    for (const head of this._oneFollowers) head.pointer(pointer.clientX, pointer.clientY);
  };
  private readonly _oneOnVisibility = (): void => this._oneVisibilityChanged();

  constructor(private readonly win: Window) {
    this.inputAt = this.now();
    const IO = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    this._oneIo = IO ? new IO(entries => {
      for (const entry of entries) {
        const head = this._oneHeadFor(entry.target);
        if (head) head.setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.6);
      }
    }, { threshold: [0, 0.6, 1] }) : null;
    const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    this._oneRo = RO ? new RO(entries => {
      for (const entry of entries) {
        const head = this._oneHeadFor(entry.target);
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
  scrolling(): boolean { return this.now() - this._oneScrollAt < 200; }
  /** Viewer input keeps repeating cadences alive. */
  idle(): boolean { return this.now() - this.inputAt > 60_000; }

  private _oneHeadFor(target: Element): OneHead | undefined { return this._oneByRoot.get(target); }

  add(head: OneHead): void {
    if (!this._oneHeads.size) {
      const options = { capture: true, passive: true } as const;
      this.win.addEventListener('scroll', this._oneOnScroll, options);
      this.win.addEventListener('pointermove', this._oneOnPointer, options);
      for (const type of INPUTS) this.win.addEventListener(type, this._oneOnInput, options);
      this.win.document.addEventListener('visibilitychange', this._oneOnVisibility);
    }
    this._oneHeads.add(head);
    if (head.follows) this._oneFollowers.add(head);
    this._oneByRoot.set(head.root, head);
    if (this._oneIo) this._oneIo.observe(head.root); else head.setVisible(true);
    this._oneRo?.observe(head.root);
  }

  /** A head's root element is replaced when its paint changes: keep observing the new one. */
  replaced(previous: Element, head: OneHead): void {
    this._oneIo?.unobserve(previous);
    this._oneRo?.unobserve(previous);
    this._oneByRoot.delete(previous);
    this._oneByRoot.set(head.root, head);
    if (this._oneIo) this._oneIo.observe(head.root);
    this._oneRo?.observe(head.root);
  }

  remove(head: OneHead): void {
    if (!this._oneHeads.delete(head)) return;
    this._oneByRoot.delete(head.root);
    this._oneIo?.unobserve(head.root);
    this._oneRo?.unobserve(head.root);
    this._oneTicking.delete(head);
    this._oneWaiting.delete(head);
    this._oneFollowers.delete(head);
    this._oneQueue = this._oneQueue.filter(item => item.head !== head);
    this.release(head);
    if (!this._oneHeads.size) {
      const options = { capture: true } as const;
      this.win.removeEventListener('scroll', this._oneOnScroll, options);
      this.win.removeEventListener('pointermove', this._oneOnPointer, options);
      for (const type of INPUTS) this.win.removeEventListener(type, this._oneOnInput, options);
      this.win.document.removeEventListener('visibilitychange', this._oneOnVisibility);
      if (this._oneRaf) this.win.cancelAnimationFrame(this._oneRaf);
      this._oneRaf = 0;
      if (this._onePumpTimer) this.win.clearTimeout(this._onePumpTimer);
      this._onePumpTimer = 0;
      stages.delete(this.win);
    }
  }

  private _oneInput(): void {
    const wasIdle = this.idle();
    this.inputAt = this.now();
    if (wasIdle && this._oneWaiting.size) {
      const resumed = [...this._oneWaiting];
      this._oneWaiting.clear();
      for (const head of resumed) head.scheduleCadence();
    }
  }
  waitForInput(head: OneHead): void { this._oneWaiting.add(head); }
  stopWaiting(head: OneHead): void { this._oneWaiting.delete(head); }

  private _oneCap(): number { return this.win.innerWidth > 0 && this.win.innerWidth < 600 ? 2 : 3; }
  private _oneGroupMover(head: OneHead): OneHead | undefined {
    for (const mover of this._oneMovers) if (mover !== head && mover.group === head.group) return mover;
    return undefined;
  }
  private _oneCanStart(head: OneHead): boolean {
    return !this.hidden && !this.scrolling() && !this._oneGroupMover(head) && this._oneMovers.size < this._oneCap();
  }

  /** Ask for a moment. It starts now, waits for a slot, or is dropped after 1.5 s. */
  request(head: OneHead, request: OneMomentRequest): void {
    if (!head.motionAllowed || this.hidden) { head.snap(); return; }
    if (request.uncounted) { this._oneBegin(head, request); return; }
    if (request.user) {
      // The viewer's own act (a tap, a new colour, First blink) is not held to the window's cap, but it never moves
      // beside another head of its group: a cadence there is cut short, anything else finishes first.
      const other = this._oneGroupMover(head);
      if (!other) { this._oneBegin(head, request); return; }
      if (other.motion.request?.cadence) other.cutCadence();
      this._oneEnqueue(head, request);
      return;
    }
    if (this._oneMovers.has(head)) {
      const current = head.motion.request;
      if (current && !current.cadence && current.priority > request.priority) { this._oneEnqueue(head, request); return; }
      this._oneBegin(head, request);
      return;
    }
    const other = this._oneGroupMover(head);
    if (other && other.motion.request?.cadence && request.priority >= 4) other.cutCadence();
    if (this._oneCanStart(head)) { this._oneBegin(head, request); return; }
    this._oneEnqueue(head, request);
  }

  private _oneBegin(head: OneHead, request: OneMomentRequest): void {
    this._oneQueue = this._oneQueue.filter(item => item.head !== head);
    head.start(request, this.now());
    if (!request.uncounted) this._oneMovers.add(head);
    this.tick(head);
  }

  private _oneEnqueue(head: OneHead, request: OneMomentRequest): void {
    this._oneQueue = this._oneQueue.filter(item => item.head !== head);
    this._oneQueue.push({ head, request, at: this.now() });
    this._oneArmPump();
  }

  private _oneArmPump(): void {
    if (!this._onePumpTimer && this._oneQueue.length) this._onePumpTimer = this.win.setTimeout(() => { this._onePumpTimer = 0; this._onePump(); }, 100);
  }

  private _onePump(): void {
    const now = this.now();
    this._oneQueue.sort((a, b) => b.request.priority - a.request.priority || a.at - b.at);
    const keep: Queued[] = [];
    // Groups whose face changed in this pass: one change per group per pass, so held faces never switch together.
    const changed = new Set<unknown>();
    for (const item of this._oneQueue) {
      if (!item.head.visible || !item.head.motionAllowed) continue;
      if (changed.has(item.head.group)) { keep.push(item); continue; }
      // Missed is missed: past 1.5 s the head does not perform late. It switches straight to its held face, without
      // moving to it and without taking a slot.
      if (now - item.at > 1500) { changed.add(item.head.group); item.head.drop(); continue; }
      if (item.request.user ? !this.hidden && !this._oneGroupMover(item.head) : this._oneCanStart(item.head)) {
        changed.add(item.head.group);
        this._oneBegin(item.head, item.request);
        continue;
      }
      keep.push(item);
    }
    this._oneQueue = keep;
    this._oneArmPump();
  }

  /** A head's move ended. The next waiting move starts on the next pump, a beat later, never in the same frame. */
  release(head: OneHead): void {
    if (this._oneMovers.delete(head) && this._oneQueue.length) this._oneArmPump();
  }

  cancel(head: OneHead): void {
    this._oneQueue = this._oneQueue.filter(item => item.head !== head);
    this._oneTicking.delete(head);
    this.release(head);
  }

  /** Keep a moving head on the shared ticker. */
  tick(head: OneHead): void {
    this._oneTicking.add(head);
    if (!this._oneRaf && !this.hidden) this._oneRaf = this.win.requestAnimationFrame(() => this._oneFrame());
  }

  private _oneFrame(): void {
    this._oneRaf = 0;
    if (this.hidden) return;
    const now = this.now();
    const scrolling = this.scrolling();
    for (const head of [...this._oneTicking]) if (!head.step(now, scrolling)) this._oneTicking.delete(head);
    if (this._oneTicking.size) this._oneRaf = this.win.requestAnimationFrame(() => this._oneFrame());
  }

  private _oneVisibilityChanged(): void {
    if (this.hidden) {
      if (this._oneRaf) this.win.cancelAnimationFrame(this._oneRaf);
      this._oneRaf = 0;
      this._oneQueue = [];
      for (const head of this._oneHeads) head.hide();
      this._oneMovers.clear();
      this._oneTicking.clear();
    } else {
      for (const head of this._oneHeads) if (head.visible) head.show();
    }
  }
}

export interface OneHeadOptions {
  /** The shape drawn, or 'charcoal' for Digital One's circle. A blank head takes the shape the agent will get. */
  readonly kind: OneKind;
  readonly color: OneHeadColor;
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
  private readonly _oneStage: OneStage;
  private readonly _oneDoc: Document;
  private _oneKind: OneKind;
  private _oneColor: OneHeadColor;
  private _oneTheme: OneTheme;
  private _oneLabel: string | undefined;
  private _onePx: number;
  private _oneSpeaking: boolean;
  private _oneSeen: OneFace;
  private _oneReduced: boolean;
  private readonly _oneAnimated: boolean;
  private _oneCadenceTimer = 0;
  private _oneFollowTimer = 0;
  private _oneDisposed = false;
  private _oneWash: { readonly from: OnePaint; readonly start: number } | null = null;
  private _oneGesture: { readonly request: OneMomentRequest; readonly at: number } | null = null;
  private _oneParts!: { disc: SVGElement; eye: SVGElement; bar: SVGElement; mouth: SVGElement; body: SVGElement; keyline: SVGElement | null; rim: SVGElement | null };
  private _oneWritten: Record<string, string> = {};
  private readonly _oneInstance: string;

  constructor(host: Element, options: OneHeadOptions) {
    this._oneDoc = host.ownerDocument!;
    const win = this._oneDoc.defaultView!;
    this._oneStage = OneStage.for(win);
    if (options.color === 'charcoal' ? options.kind !== 'charcoal' : options.kind === 'charcoal') throw new TypeError('Digital One is charcoal in shape and colour alike');
    this._oneKind = options.kind;
    this._oneColor = options.color;
    this._oneTheme = options.theme;
    this._oneLabel = options.label;
    this._onePx = options.size;
    this._oneSpeaking = options.speaking;
    this._oneReduced = options.reduced;
    this._oneAnimated = options.animated;
    this.follows = options.follow === true;
    this._oneSeen = options.face;
    this._oneInstance = 'oaid-one-' + Array.from(win.crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16)).join('-');
    this.group = options.group ?? host.closest(LIST_CONTAINERS) ?? this;
    this.motion = new OneMotion({ face: options.face, gaze: options.gaze, px: this._onePx,
      kind: this._oneKind, random: options.random, cadence: options.cadence,
      ...(options.voiceLevel ? { level: options.voiceLevel } : {}), motion: this.motionAllowed, at: this._oneStage.now() });
    this.motion.setBlink(options.blink);
    this._oneBuild();
    this._oneSetStateAttributes(options.status, options.expression);
    // A still One rendered on the server for this element is replaced in place, so hydration never adds a second head.
    const still = Array.from(host.children).find(child => child.localName === 'svg' &&
      child.getAttribute('data-character-skin') === 'one' && !child.hasAttribute('data-character-player'));
    if (still) still.replaceWith(this.root); else host.append(this.root);
    this._oneStage.add(this);
  }

  get motionAllowed(): boolean { return !this._oneReduced && this._oneAnimated && !this._oneDisposed; }

  private _oneNode(tag: string, attributes: Readonly<Record<string, string>> = {}): SVGElement {
    const element = this._oneDoc.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  /**
   * The head's DOM: 5–8 nodes, plus a mask for Digital One's knocked-out eye on light surfaces. The body is the shape's
   * path, the eye sits in the shape's eye group, and a keyline or Digital One's rim is the outline inset by half its
   * width, stroked, never a clip. Sets `root`.
   */
  private _oneBuild(): void {
    const paint = onePaint(this._oneColor, this._oneTheme);
    const shape = oneShapeGeometry(this._oneKind);
    const root = this._oneNode('svg', { xmlns: SVG, viewBox: '-100 -100 200 200', width: String(this._onePx), height: String(this._onePx),
      overflow: 'visible', 'data-character-player': 'agent-eye-v1', 'data-character-skin': 'one', 'data-character-version': '1',
      'data-character-shape': this._oneKind, 'data-character-theme': this._oneTheme, 'data-one-shape': oneShapeId(this._oneKind), 'data-one-color': this._oneColor }) as SVGSVGElement;
    if (this._oneLabel === undefined) { root.setAttribute('aria-hidden', 'true'); root.setAttribute('focusable', 'false'); }
    else {
      root.setAttribute('role', 'img');
      root.setAttribute('aria-label', this._oneLabel);
      const title = this._oneNode('title');
      title.textContent = this._oneLabel;
      root.append(title);
    }
    const body = this._oneNode('g', { 'data-character-body': 'true' });
    const disc = this._oneNode('path', { 'data-one-disc': 'true', d: shape.path, fill: paint.disc });
    const eye = this._oneNode('g', { 'data-character-eyes': 'agent-eye-v1' });
    const ink = paint.eye ?? '#000000';
    const bar = this._oneNode('path', { 'data-one-eye': 'true', fill: ink, stroke: ink, 'stroke-linejoin': 'round' });
    const mouth = this._oneNode('rect', { 'data-one-mouth': 'true', fill: ink, display: 'none' });
    eye.append(bar);
    let keyline: SVGElement | null = null, rim: SVGElement | null = null;
    if (paint.eye === null) {
      const mask = this._oneNode('mask', { id: this._oneInstance, maskUnits: 'userSpaceOnUse', x: '-100', y: '-100', width: '200', height: '200' });
      mask.append(this._oneNode('rect', { x: '-100', y: '-100', width: '200', height: '200', fill: '#ffffff' }), eye, mouth);
      const defs = this._oneNode('defs');
      defs.append(mask);
      root.append(defs);
      disc.setAttribute('mask', `url(#${this._oneInstance})`);
      body.append(disc);
    } else {
      body.append(disc);
      if (paint.keyline !== null) {
        keyline = this._oneNode('path', { 'data-one-keyline': 'true', fill: 'none', stroke: paint.keyline });
        body.append(keyline);
      }
      if (paint.rim !== null) {
        rim = this._oneNode('path', { 'data-one-rim': 'true', fill: 'none', stroke: paint.rim.color, 'stroke-opacity': String(paint.rim.opacity) });
        body.append(rim);
      }
      body.append(eye, mouth);
    }
    root.append(body);
    this.root = root;
    this._oneParts = { disc, eye, bar, mouth, body, keyline, rim };
    this._oneWritten = {};
    this._oneKeyline();
    // Repaint without advancing time: a moment that ends now still finishes on the ticker and frees its slot.
    this._onePaint(this.motion.peek(this._oneStage.now()), true);
  }

  /** The keyline and the rim follow the rendered size: an inset outline at half the stroke's width. */
  private _oneKeyline(): void {
    const path = oneShapeGeometry(this._oneKind).path;
    const inset = (element: SVGElement, width: number): void => {
      element.setAttribute('d', oneInsetPath(path, width / 2));
      element.setAttribute('stroke-width', String(Number(width.toFixed(4))));
    };
    if (this._oneParts.keyline) inset(this._oneParts.keyline, oneKeylineWidth(this._onePx, this._oneDoc.defaultView?.devicePixelRatio ?? 1));
    if (this._oneParts.rim) inset(this._oneParts.rim, oneRimWidth(this._onePx));
  }

  private _oneWrite(element: Element, key: string, attribute: string, value: string | null): void {
    if (this._oneWritten[key] === (value ?? '\u0000')) return;
    this._oneWritten[key] = value ?? '\u0000';
    if (value === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, value);
  }

  /** At most a few diffed attribute writes per frame; no layout reads. */
  private _onePaint(frame: OneMotionFrame, force = false): void {
    if (force) this._oneWritten = {};
    const { geometry } = frame;
    this._oneWrite(this._oneParts.eye, 'eye', 'transform', geometry.eye);
    this._oneWrite(this._oneParts.bar, 'bar', 'd', geometry.bar);
    this._oneWrite(this._oneParts.bar, 'stroke', 'stroke-width', String(geometry.strokeWidth));
    this._oneWrite(this._oneParts.mouth, 'mouth', 'display', geometry.mouth ? 'inline' : 'none');
    if (geometry.mouth) {
      for (const key of ['x', 'y', 'width', 'height', 'rx', 'opacity'] as const) this._oneWrite(this._oneParts.mouth, `mouth-${key}`, key, String(geometry.mouth[key]));
    }
    this._oneWrite(this._oneParts.body, 'body', 'transform', geometry.body || null);
    this._oneWrite(this.root, 'face', 'data-one-face', frame.face);
    this._oneWrite(this.root, 'tier', 'data-one-tier', frame.tier);
    this._onePaintColour();
  }

  /** The disc's colour: a blank head's tint, the colour itself, or the First blink wash between them. */
  private _onePaintColour(): void {
    const paint = onePaint(this._oneColor, this._oneTheme);
    const wash = this._oneWash;
    const u = wash ? ui(Math.min(1, Math.max(0, (this._oneStage.now() - wash.start) / WASH_MS))) : 1;
    if (wash && u >= 1) this._oneWash = null;
    const from = wash && u < 1 ? wash.from : paint;
    const opacity = from.discOpacity + (paint.discOpacity - from.discOpacity) * u;
    this._oneWrite(this._oneParts.disc, 'disc', 'fill', mix(from.disc, paint.disc, u));
    this._oneWrite(this._oneParts.disc, 'disc-opacity', 'fill-opacity', opacity >= 1 ? null : String(Number(opacity.toFixed(3))));
    if (this._oneParts.keyline) this._oneWrite(this._oneParts.keyline, 'keyline', 'stroke-opacity', u >= 1 ? null : String(Number(u.toFixed(3))));
    if (this._oneParts.rim && paint.rim) this._oneWrite(this._oneParts.rim, 'rim', 'stroke-opacity', String(Number((paint.rim.opacity * u).toFixed(3))));
    if (paint.eye !== null) {
      const ink = from.eye === null ? paint.eye : mix(from.eye, paint.eye, u);
      this._oneWrite(this._oneParts.bar, 'ink', 'fill', ink);
      this._oneWrite(this._oneParts.bar, 'ink-stroke', 'stroke', ink);
      this._oneWrite(this._oneParts.mouth, 'mouth-ink', 'fill', ink);
    }
  }

  private _oneSetStateAttributes(status: string, expression: string): void {
    this.root.setAttribute('data-character-status', status);
    this.root.setAttribute('data-character-expression', expression);
  }

  /** Apply a resolved runtime state. */
  setState(face: OneFace, gaze: { readonly x: number; readonly y: number }, blink: number, status: string, expression: string): void {
    if (this._oneDisposed) return;
    this._oneSetStateAttributes(status, expression);
    this._oneSpeaking = status === 'speaking';
    this.motion.setBlink(blink);
    this.motion.noteInput(this._oneStage.inputAt);
    const request = this.motion.setFace(face, gaze, this._oneStage.now());
    if (!request) {
      if (!this.motion.moving) this._onePaint(this.motion.sample(this._oneStage.now()).frame);
      if (this._oneSpeaking) this._oneStartTalk();
      return;
    }
    this._oneStopCadence();
    this._oneStopFollow();
    // Since you looked: a hidden head records the change and performs it when it comes into view.
    if (!this.visible || this._oneStage.hidden) { this.motion.snap(); this._onePaint(this.motion.sample(this._oneStage.now()).frame); return; }
    this._oneSeen = face;
    this._oneStage.request(this, request);
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
    if (!scrolling || !playing || finished) this._onePaint(frame);
    if (finished) {
      this._oneStage.release(this);
      if (this._oneSpeaking) this._oneStartTalk();
      else this.scheduleCadence();
    }
    const moving = this.motion.moving || this._oneWash !== null;
    if (!moving) this.root.removeAttribute('data-moving');
    return moving;
  }

  private _oneStartTalk(): void {
    if (this.visible && this.motion.startTalk(this._oneStage.now())) {
      this.root.setAttribute('data-moving', '');
      this._oneStage.tick(this);
    }
  }

  /** The window's pointer moved: follow it with the eye when it is near, rest 1.6 s after it stops. */
  pointer(x: number, y: number): void {
    if (!this.visible || !this.motionAllowed || this._oneStage.hidden) return;
    const current = this.motion.request;
    if (current && !current.uncounted) return;
    const tier = oneTier(this._onePx);
    if (tier !== 'M' && tier !== 'L') return;
    const box = this.root.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    if (Math.hypot(x - cx, y - cy) > FOLLOW_RANGE + box.width / 2) { if (this.motion.following) this._oneEndFollow(); return; }
    const reach = this._oneStage.reach;
    if (!this.motion.follow({ x: Math.tanh((x - cx) / reach * 1.4), y: Math.tanh((y - cy) / reach * 1.4) })) return;
    this.root.setAttribute('data-moving', '');
    this._oneStage.tick(this);
    const win = this._oneDoc.defaultView!;
    if (this._oneFollowTimer) win.clearTimeout(this._oneFollowTimer);
    this._oneFollowTimer = win.setTimeout(() => { this._oneFollowTimer = 0; this._oneEndFollow(); }, FOLLOW_REST_MS);
  }

  private _oneEndFollow(): void {
    this._oneStopFollow();
    if (this.visible && this.motionAllowed) this._oneStage.request(this, { name: 'home', priority: 0, uncounted: true });
  }

  private _oneStopFollow(): void {
    if (this._oneFollowTimer) this._oneDoc.defaultView?.clearTimeout(this._oneFollowTimer);
    this._oneFollowTimer = 0;
    this.motion.follow(null);
  }

  /** Ongoing work moves briefly in lists and in clusters in headers; nothing is scheduled at rest. */
  scheduleCadence(): void {
    this._oneStopCadence();
    if (!this.visible || !this.motionAllowed || this._oneStage.hidden) return;
    this.motion.noteInput(this._oneStage.inputAt);
    const now = this._oneStage.now();
    const delay = this.motion.nextCadence(now);
    if (delay === null) {
      if (this.motion.cadenceRequest() && this._oneStage.idle()) this._oneStage.waitForInput(this);
      return;
    }
    this._oneCadenceTimer = this._oneDoc.defaultView!.setTimeout(() => {
      this._oneCadenceTimer = 0;
      const request = this.motion.cadenceRequest();
      if (request && this.visible) this._oneStage.request(this, request);
    }, delay);
  }

  private _oneStopCadence(): void {
    if (this._oneCadenceTimer) this._oneDoc.defaultView?.clearTimeout(this._oneCadenceTimer);
    this._oneCadenceTimer = 0;
    this._oneStage.stopWaiting(this);
  }

  /**
   * A higher-priority entrance in the same group ends an ongoing cadence early. The head keeps its slot while it
   * settles (160 ms), so the entrance starts once it has: never two heads moving in one group.
   */
  cutCadence(): void {
    this._oneStopCadence();
    this.start({ name: 'settle', priority: 0 }, this._oneStage.now());
    this._oneStage.tick(this);
  }

  /** A queued moment missed its slot: the held face at once, without moving (it holds no slot). */
  drop(): void {
    this.motion.snap();
    this._oneWash = null;
    this.root.removeAttribute('data-moving');
    this._onePaint(this.motion.sample(this._oneStage.now()).frame, true);
    if (this._oneSpeaking) this._oneStartTalk();
    else this.scheduleCadence();
  }

  /**
   * A gesture the host chooses: an arrival (it takes a motion slot like a state change) or, with `viewer`, the
   * viewer's tap on a hero (it starts at once). It plays only where the head may move and is big enough to carry
   * it, and a head that needs the viewer never smiles, waves, shrugs or pops. A head not yet in view plays an
   * arrival when it comes into view, within 1.5 s. Returns whether it was accepted.
   */
  play(name: OneGesture, viewer: boolean): boolean {
    if (this._oneDisposed || !this.motionAllowed || this._oneStage.hidden) return false;
    const tier = this.motion.tier;
    const big = tier === 'M' || tier === 'L';
    const light = name === 'lookAtYou' || name === 'nod';
    if (tier === 'XS' || (!big && !light)) return false;
    if (!light && (this.motion.face === 'attention' || this._oneSpeaking)) return false;
    const request: OneMomentRequest = viewer ? { name, priority: 5, user: true } : { name, priority: 3 };
    if (!this.visible) {
      if (viewer) return false;
      this._oneGesture = { request, at: this._oneStage.now() };
      return true;
    }
    this._oneGesture = null;
    this._oneStopCadence();
    this._oneStopFollow();
    this._oneStage.request(this, request);
    return true;
  }

  /** Hold the face still, ending any motion. */
  snap(): void {
    this._oneStopCadence();
    this._oneStopFollow();
    this._oneStage.cancel(this);
    this.motion.snap();
    this._oneWash = null;
    this._oneGesture = null;
    this.root.removeAttribute('data-moving');
    this._onePaint(this.motion.sample(this._oneStage.now()).frame, true);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.show(); else this.hide();
  }

  show(): void {
    if (this._oneDisposed || this._oneStage.hidden) return;
    const gesture = this._oneGesture;
    this._oneGesture = null;
    if (!this.motionAllowed) { this.snap(); this._oneSeen = this.motion.face; return; }
    const face = this.motion.face;
    if (this._oneSeen !== face) {
      const previous = this._oneSeen;
      this._oneSeen = face;
      this._oneStage.request(this, this.motion.entrance(previous, face));
      return;
    }
    if (gesture && this._oneStage.now() - gesture.at <= GESTURE_WAIT_MS) { this._oneStage.request(this, gesture.request); return; }
    if (this._oneSpeaking) { this._oneStartTalk(); return; }
    const cadence = this.motion.cadenceRequest();
    if (cadence) {
      this.motion.restartWindow(this._oneStage.now());
      this._oneStage.request(this, { ...cadence, priority: 1 });
    }
  }

  hide(): void {
    this._oneStopCadence();
    if (this.motion.moving || this._oneWash) this.snap();
    else this._oneStage.cancel(this);
  }

  setRenderedSize(px: number): void {
    const rounded = Math.round(px);
    if (!Number.isFinite(rounded) || rounded <= 0 || rounded === this._onePx) return;
    const tier = oneTier(this._onePx) !== oneTier(rounded);
    this._onePx = rounded;
    this.motion.setSize(rounded);
    this._oneKeyline();
    if (tier && !this.motion.moving) this._onePaint(this.motion.sample(this._oneStage.now()).frame);
  }

  setReduced(reduced: boolean): void {
    this._oneReduced = reduced;
    this.motion.setMotion(this.motionAllowed);
    if (!this.motionAllowed) this.snap();
    else if (this.visible) { this._oneSeen = this.motion.face; this.show(); }
  }

  /**
   * Change the look, the surface, the size or the name. A new shape or colour waves at 40 px and up; a blank head
   * that is given a colour plays First blink instead (its disc washes to the colour while the eye opens for the first
   * time).
   */
  setPaint(kind: OneKind, color: OneHeadColor, theme: OneTheme, size: number, label: string | undefined): void {
    if (color === 'charcoal' ? kind !== 'charcoal' : kind === 'charcoal') throw new TypeError('Digital One is charcoal in shape and colour alike');
    const recolour = kind !== this._oneKind || color !== this._oneColor;
    if (!recolour && theme === this._oneTheme && label === this._oneLabel) {
      if (size !== this._onePx) { this.root.setAttribute('width', String(size)); this.root.setAttribute('height', String(size)); this.setRenderedSize(size); }
      return;
    }
    const before = onePaint(this._oneColor, this._oneTheme);
    const firstBlink = this._oneColor === 'blank' && color !== 'blank';
    this._oneKind = kind;
    this._oneColor = color;
    this._oneTheme = theme;
    this._oneLabel = label;
    this._onePx = size;
    this.motion.setSize(size);
    this.motion.setKind(kind);
    const previous = this.root;
    this._oneBuild();
    for (const name of ['data-character-status', 'data-character-expression', 'data-moving'] as const) {
      const value = previous.getAttribute(name);
      if (value !== null) this.root.setAttribute(name, value);
    }
    previous.replaceWith(this.root);
    this._oneStage.replaced(previous, this);
    if (!recolour || !this.visible || !this.motionAllowed) return;
    if (firstBlink && this.motion.tier !== 'XS') {
      this._oneWash = { from: before, start: this._oneStage.now() };
      this._onePaintColour();
      this._oneStage.request(this, { name: 'firstBlink', priority: 7, user: true });
    } else if (this.motion.tier === 'M' || this.motion.tier === 'L') {
      this._oneStage.request(this, { name: 'wave', priority: 4, user: true });
    }
  }

  dispose(): void {
    if (this._oneDisposed) return;
    this._oneDisposed = true;
    this._oneStopCadence();
    this._oneStopFollow();
    this._oneStage.remove(this);
    this.root.remove();
  }
}
