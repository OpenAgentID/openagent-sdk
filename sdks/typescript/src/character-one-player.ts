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
import { oneError } from './one-error.js';
import { oneShapeInsetPath, oneKeylineWidth, onePaint, oneRimWidth, oneShapeGeometry, oneShapeId, oneTier,
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

interface OneStage {
  inputAt: number;
  now(): number;
  readonly hidden: boolean;
  readonly reach: number;
  scrolling(): boolean;
  idle(): boolean;
  add(head: OneHead): void;
  replaced(previous: Element, head: OneHead): void;
  remove(head: OneHead): void;
  waitForInput(head: OneHead): void;
  stopWaiting(head: OneHead): void;
  request(head: OneHead, request: OneMomentRequest): void;
  release(head: OneHead): void;
  cancel(head: OneHead): void;
  tick(head: OneHead): void;
}

class OneStage {
  static for(win: Window): OneStage {
    let stage = stages.get(win);
    if (!stage) { stage = new OneStage(win); stages.set(win, stage); }
    return stage;
  }
  constructor(win: Window) {
    let _statewin: Window = win;
    let _state_oneHeads = new Set<OneHead>();
    let _state_oneByRoot = new WeakMap<Element, OneHead>();
    let _state_oneTicking = new Set<OneHead>();
    let _state_oneMovers = new Set<OneHead>();
    let _state_oneWaiting = new Set<OneHead>();
    let _state_oneFollowers = new Set<OneHead>();
    let _state_oneQueue: Queued[] = [];
    let _state_oneRaf: number = 0;
    let _state_onePumpTimer: number = 0;
    let _state_oneScrollAt = -Infinity;
    let _stateinputAt: number;
    let _state_oneIo: IntersectionObserver | null;
    let _state_oneRo: ResizeObserver | null;
    let _state_oneOnScroll = (): void => { _state_oneScrollAt = _callnow(); _call_oneInput(); };
    let _state_oneOnInput = (): void => _call_oneInput();
    let _state_oneOnPointer = (event: Event): void => {
    _call_oneInput();
    const pointer = event as PointerEvent;
    if (pointer.pointerType && pointer.pointerType !== 'mouse')
        return;
    for (const head of _state_oneFollowers)
        head.pointer(pointer.clientX, pointer.clientY);
};
    let _state_oneOnVisibility = (): void => _call_oneVisibilityChanged();
    function _callnow(): number {
        return _statewin.performance.now();
    }

    function _gethidden(): boolean {
        return _statewin.document.hidden;
    }

    function _getreach(): number {
        return Math.max(_statewin.innerWidth, _statewin.innerHeight) * 0.4;
    }

    function _callscrolling(): boolean {
        return _callnow() - _state_oneScrollAt < 200;
    }

    function _callidle(): boolean {
        return _callnow() - _stateinputAt > 60000;
    }

    function _call_oneHeadFor(target: Element): OneHead | undefined {
        return _state_oneByRoot.get(target);
    }

    function _call_oneListen(active: boolean): void {
        const method = active ? 'addEventListener' : 'removeEventListener';
        const options = { capture: true, passive: true } as const;
        _statewin[method]('scroll', _state_oneOnScroll, options);
        _statewin[method]('pointermove', _state_oneOnPointer, options);
        for (const type of INPUTS)
            _statewin[method](type, _state_oneOnInput, options);
        _statewin.document[method]('visibilitychange', _state_oneOnVisibility);
    }

    function _calladd(head: OneHead): void {
        if (!_state_oneHeads.size)
            _call_oneListen(true);
        _state_oneHeads.add(head);
        if (head.follows)
            _state_oneFollowers.add(head);
        _state_oneByRoot.set(head.root, head);
        if (_state_oneIo)
            _state_oneIo.observe(head.root);
        else
            head.setVisible(true);
        _state_oneRo?.observe(head.root);
    }

    function _callreplaced(previous: Element, head: OneHead): void {
        _state_oneIo?.unobserve(previous);
        _state_oneRo?.unobserve(previous);
        _state_oneByRoot.delete(previous);
        _state_oneByRoot.set(head.root, head);
        if (_state_oneIo)
            _state_oneIo.observe(head.root);
        _state_oneRo?.observe(head.root);
    }

    function _callremove(head: OneHead): void {
        if (!_state_oneHeads.delete(head))
            return;
        _state_oneByRoot.delete(head.root);
        _state_oneIo?.unobserve(head.root);
        _state_oneRo?.unobserve(head.root);
        _state_oneTicking.delete(head);
        _state_oneWaiting.delete(head);
        _state_oneFollowers.delete(head);
        _state_oneQueue = _state_oneQueue.filter(item => item.head !== head);
        _callrelease(head);
        if (!_state_oneHeads.size) {
            _call_oneListen(false);
            if (_state_oneRaf)
                _statewin.cancelAnimationFrame(_state_oneRaf);
            _state_oneRaf = 0;
            if (_state_onePumpTimer)
                _statewin.clearTimeout(_state_onePumpTimer);
            _state_onePumpTimer = 0;
            stages.delete(_statewin);
        }
    }

    function _call_oneInput(): void {
        const wasIdle = _callidle();
        _stateinputAt = _callnow();
        if (wasIdle && _state_oneWaiting.size) {
            const resumed = [..._state_oneWaiting];
            _state_oneWaiting.clear();
            for (const head of resumed)
                head.scheduleCadence();
        }
    }

    function _callwaitForInput(head: OneHead): void {
        _state_oneWaiting.add(head);
    }

    function _callstopWaiting(head: OneHead): void {
        _state_oneWaiting.delete(head);
    }

    function _call_oneCap(): number {
        return _statewin.innerWidth > 0 && _statewin.innerWidth < 600 ? 2 : 3;
    }

    function _call_oneGroupMover(head: OneHead): OneHead | undefined {
        for (const mover of _state_oneMovers)
            if (mover !== head && mover.group === head.group)
                return mover;
        return undefined;
    }

    function _call_oneCanStart(head: OneHead): boolean {
        return !_gethidden() && !_callscrolling() && !_call_oneGroupMover(head) && _state_oneMovers.size < _call_oneCap();
    }

    function _callrequest(head: OneHead, request: OneMomentRequest): void {
        if (!head.motionAllowed || _gethidden()) {
            head.snap();
            return;
        }
        if (request.uncounted) {
            _call_oneBegin(head, request);
            return;
        }
        if (request.user) {
            // The viewer's own act (a tap, a new colour, First blink) is not held to the window's cap, but it never moves
            // beside another head of its group: a cadence there is cut short, anything else finishes first.
            const other = _call_oneGroupMover(head);
            if (!other) {
                _call_oneBegin(head, request);
                return;
            }
            if (other.motion.request?.cadence)
                other.cutCadence();
            _call_oneEnqueue(head, request);
            return;
        }
        if (_state_oneMovers.has(head)) {
            const current = head.motion.request;
            if (current && !current.cadence && current.priority > request.priority) {
                _call_oneEnqueue(head, request);
                return;
            }
            _call_oneBegin(head, request);
            return;
        }
        const other = _call_oneGroupMover(head);
        if (other && other.motion.request?.cadence && request.priority >= 4)
            other.cutCadence();
        if (_call_oneCanStart(head)) {
            _call_oneBegin(head, request);
            return;
        }
        _call_oneEnqueue(head, request);
    }

    function _call_oneBegin(head: OneHead, request: OneMomentRequest): void {
        _state_oneQueue = _state_oneQueue.filter(item => item.head !== head);
        head.start(request, _callnow());
        if (!request.uncounted)
            _state_oneMovers.add(head);
        _calltick(head);
    }

    function _call_oneEnqueue(head: OneHead, request: OneMomentRequest): void {
        _state_oneQueue = _state_oneQueue.filter(item => item.head !== head);
        _state_oneQueue.push({ head, request, at: _callnow() });
        _call_oneArmPump();
    }

    function _call_oneArmPump(): void {
        if (!_state_onePumpTimer && _state_oneQueue.length)
            _state_onePumpTimer = _statewin.setTimeout(() => { _state_onePumpTimer = 0; _call_onePump(); }, 100);
    }

    function _call_onePump(): void {
        const now = _callnow();
        _state_oneQueue.sort((a, b) => b.request.priority - a.request.priority || a.at - b.at);
        const keep: Queued[] = [];
        // Groups whose face changed in this pass: one change per group per pass, so held faces never switch together.
        const changed = new Set<unknown>();
        for (const item of _state_oneQueue) {
            if (!item.head.visible || !item.head.motionAllowed)
                continue;
            if (changed.has(item.head.group)) {
                keep.push(item);
                continue;
            }
            // Missed is missed: past 1.5 s the head does not perform late. It switches straight to its held face, without
            // moving to it and without taking a slot.
            if (now - item.at > 1500) {
                changed.add(item.head.group);
                item.head.drop();
                continue;
            }
            if (item.request.user ? !_gethidden() && !_call_oneGroupMover(item.head) : _call_oneCanStart(item.head)) {
                changed.add(item.head.group);
                _call_oneBegin(item.head, item.request);
                continue;
            }
            keep.push(item);
        }
        _state_oneQueue = keep;
        _call_oneArmPump();
    }

    function _callrelease(head: OneHead): void {
        if (_state_oneMovers.delete(head) && _state_oneQueue.length)
            _call_oneArmPump();
    }

    function _callcancel(head: OneHead): void {
        _state_oneQueue = _state_oneQueue.filter(item => item.head !== head);
        _state_oneTicking.delete(head);
        _callrelease(head);
    }

    function _calltick(head: OneHead): void {
        _state_oneTicking.add(head);
        if (!_state_oneRaf && !_gethidden())
            _state_oneRaf = _statewin.requestAnimationFrame(() => _call_oneFrame());
    }

    function _call_oneFrame(): void {
        _state_oneRaf = 0;
        if (_gethidden())
            return;
        const now = _callnow();
        const scrolling = _callscrolling();
        for (const head of [..._state_oneTicking])
            if (!head.step(now, scrolling))
                _state_oneTicking.delete(head);
        if (_state_oneTicking.size)
            _state_oneRaf = _statewin.requestAnimationFrame(() => _call_oneFrame());
    }

    function _call_oneVisibilityChanged(): void {
        if (_gethidden()) {
            if (_state_oneRaf)
                _statewin.cancelAnimationFrame(_state_oneRaf);
            _state_oneRaf = 0;
            _state_oneQueue = [];
            for (const head of _state_oneHeads)
                head.hide();
            _state_oneMovers.clear();
            _state_oneTicking.clear();
        }
        else {
            for (const head of _state_oneHeads)
                if (head.visible)
                    head.show();
        }
    }
    const api: OneStage = {
      get inputAt() { return _stateinputAt; }, set inputAt(value: number) { _stateinputAt = value; },
      now: _callnow,
      get hidden() { return _gethidden(); },
      get reach() { return _getreach(); },
      scrolling: _callscrolling,
      idle: _callidle,
      add: _calladd,
      replaced: _callreplaced,
      remove: _callremove,
      waitForInput: _callwaitForInput,
      stopWaiting: _callstopWaiting,
      request: _callrequest,
      release: _callrelease,
      cancel: _callcancel,
      tick: _calltick
    };
    Object.setPrototypeOf(api, new.target.prototype);

    _stateinputAt = _callnow();
    const IO = (win as unknown as {
        IntersectionObserver?: typeof IntersectionObserver;
    }).IntersectionObserver;
    _state_oneIo = IO ? new IO(entries => {
        for (const entry of entries) {
            const head = _call_oneHeadFor(entry.target);
            if (head)
                head.setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.6);
        }
    }, { threshold: [0, 0.6, 1] }) : null;
    const RO = (win as unknown as {
        ResizeObserver?: typeof ResizeObserver;
    }).ResizeObserver;
    _state_oneRo = RO ? new RO(entries => {
        for (const entry of entries) {
            const head = _call_oneHeadFor(entry.target);
            if (head && entry.contentRect.width > 0)
                head.setRenderedSize(entry.contentRect.width);
        }
    }) : null;

    return api;
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
export interface OneHead {
  root: SVGSVGElement;
  readonly motion: OneMotion;
  readonly group: unknown;
  readonly follows: boolean;
  visible: boolean;
  readonly motionAllowed: boolean;
  setState(face: OneFace, gaze: { readonly x: number; readonly y: number }, blink: number, status: string, expression: string): void;
  start(request: OneMomentRequest, at: number): void;
  step(at: number, scrolling: boolean): boolean;
  pointer(x: number, y: number): void;
  scheduleCadence(): void;
  cutCadence(): void;
  drop(): void;
  play(name: OneGesture, viewer: boolean): boolean;
  snap(): void;
  setVisible(visible: boolean): void;
  show(): void;
  hide(): void;
  setRenderedSize(px: number): void;
  setReduced(reduced: boolean): void;
  setPaint(kind: OneKind, color: OneHeadColor, theme: OneTheme, size: number, label: string | undefined): void;
  dispose(): void;
}

export class OneHead {

  constructor(host: Element, options: OneHeadOptions) {
    let _stateroot!: SVGSVGElement;
    let _statemotion: OneMotion;
    let _stategroup: unknown;
    let _statefollows: boolean;
    let _statevisible: boolean = false;
    let _state_oneStage: OneStage;
    let _state_oneDoc: Document;
    let _state_oneKind: OneKind;
    let _state_oneColor: OneHeadColor;
    let _state_oneTheme: OneTheme;
    let _state_oneLabel: string | undefined;
    let _state_onePx: number;
    let _state_oneSpeaking: boolean;
    let _state_oneSeen: OneFace;
    let _state_oneReduced: boolean;
    let _state_oneAnimated: boolean;
    let _state_oneCadenceTimer: number = 0;
    let _state_oneFollowTimer: number = 0;
    let _state_oneDisposed: boolean = false;
    let _state_oneWash: { readonly from: OnePaint; readonly start: number } | null = null;
    let _state_oneGesture: { readonly request: OneMomentRequest; readonly at: number } | null = null;
    let _state_oneParts: { disc: SVGElement; eye: SVGElement; bar: SVGElement; mouth: SVGElement; body: SVGElement; keyline: SVGElement | null; rim: SVGElement | null };
    let _state_oneWritten: Record<string, string> = {};
    let _state_oneInstance: string;
    function _getmotionAllowed(): boolean {
        return !_state_oneReduced && _state_oneAnimated && !_state_oneDisposed;
    }

    function _call_oneNode(tag: string, attributes: Readonly<Record<string, string>> = {}): SVGElement {
        const element = _state_oneDoc.createElementNS(SVG, tag);
        for (const [key, value] of Object.entries(attributes))
            element.setAttribute(key, value);
        return element;
    }

    function _call_oneBuild(): void {
        const paint = onePaint(_state_oneColor, _state_oneTheme);
        const shape = oneShapeGeometry(_state_oneKind);
        const root = _call_oneNode('svg', { xmlns: SVG, viewBox: '-100 -100 200 200', width: String(_state_onePx), height: String(_state_onePx),
            overflow: 'visible', 'data-character-player': 'agent-eye-v1', 'data-character-skin': 'one', 'data-character-version': '1',
            'data-character-shape': _state_oneKind, 'data-character-theme': _state_oneTheme, 'data-one-shape': oneShapeId(_state_oneKind), 'data-one-color': _state_oneColor }) as SVGSVGElement;
        if (_state_oneLabel === undefined) {
            root.setAttribute('aria-hidden', 'true');
            root.setAttribute('focusable', 'false');
        }
        else {
            root.setAttribute('role', 'img');
            root.setAttribute('aria-label', _state_oneLabel);
            const title = _call_oneNode('title');
            title.textContent = _state_oneLabel;
            root.append(title);
        }
        const body = _call_oneNode('g', { 'data-character-body': 'true' });
        const disc = _call_oneNode('path', { 'data-one-disc': 'true', d: shape.path, fill: paint.disc });
        const eye = _call_oneNode('g', { 'data-character-eyes': 'agent-eye-v1' });
        const ink = paint.eye ?? '#000000';
        const bar = _call_oneNode('path', { 'data-one-eye': 'true', fill: ink, stroke: ink, 'stroke-linejoin': 'round' });
        const mouth = _call_oneNode('rect', { 'data-one-mouth': 'true', fill: ink, display: 'none' });
        eye.append(bar);
        let keyline: SVGElement | null = null, rim: SVGElement | null = null;
        if (paint.eye === null) {
            const mask = _call_oneNode('mask', { id: _state_oneInstance, maskUnits: 'userSpaceOnUse', x: '-100', y: '-100', width: '200', height: '200' });
            mask.append(_call_oneNode('rect', { x: '-100', y: '-100', width: '200', height: '200', fill: '#ffffff' }), eye, mouth);
            const defs = _call_oneNode('defs');
            defs.append(mask);
            root.append(defs);
            disc.setAttribute('mask', `url(#${_state_oneInstance})`);
            body.append(disc);
        }
        else {
            body.append(disc);
            if (paint.keyline !== null) {
                keyline = _call_oneNode('path', { 'data-one-keyline': 'true', fill: 'none', stroke: paint.keyline });
                body.append(keyline);
            }
            if (paint.rim !== null) {
                rim = _call_oneNode('path', { 'data-one-rim': 'true', fill: 'none', stroke: paint.rim.color, 'stroke-opacity': String(paint.rim.opacity) });
                body.append(rim);
            }
            body.append(eye, mouth);
        }
        root.append(body);
        _stateroot = root;
        _state_oneParts = { disc, eye, bar, mouth, body, keyline, rim };
        _state_oneWritten = {};
        _call_oneKeyline();
        // Repaint without advancing time: a moment that ends now still finishes on the ticker and frees its slot.
        _call_onePaint(_statemotion.peek(_state_oneStage.now()), true);
    }

    function _call_oneKeyline(): void {
        const inset = (element: SVGElement, width: number): void => {
            element.setAttribute('d', oneShapeInsetPath(_state_oneKind, width / 2));
            element.setAttribute('stroke-width', String(Number(width.toFixed(4))));
        };
        if (_state_oneParts.keyline)
            inset(_state_oneParts.keyline, oneKeylineWidth(_state_onePx, _state_oneDoc.defaultView?.devicePixelRatio ?? 1));
        if (_state_oneParts.rim)
            inset(_state_oneParts.rim, oneRimWidth(_state_onePx));
    }

    function _call_oneWrite(element: Element, key: string, attribute: string, value: string | null): void {
        if (_state_oneWritten[key] === (value ?? '\u0000'))
            return;
        _state_oneWritten[key] = value ?? '\u0000';
        if (value === null)
            element.removeAttribute(attribute);
        else
            element.setAttribute(attribute, value);
    }

    function _call_onePaint(frame: OneMotionFrame, force = false): void {
        if (force)
            _state_oneWritten = {};
        const { geometry } = frame;
        _call_oneWrite(_state_oneParts.eye, 'eye', 'transform', geometry.eye);
        _call_oneWrite(_state_oneParts.bar, 'bar', 'd', geometry.bar);
        _call_oneWrite(_state_oneParts.bar, 'stroke', 'stroke-width', String(geometry.strokeWidth));
        _call_oneWrite(_state_oneParts.mouth, 'mouth', 'display', geometry.mouth ? 'inline' : 'none');
        if (geometry.mouth) {
            for (const key of ['x', 'y', 'width', 'height', 'rx', 'opacity'] as const)
                _call_oneWrite(_state_oneParts.mouth, `mouth-${key}`, key, String(geometry.mouth[key]));
        }
        _call_oneWrite(_state_oneParts.body, 'body', 'transform', geometry.body || null);
        _call_oneWrite(_stateroot, 'face', 'data-one-face', frame.face);
        _call_oneWrite(_stateroot, 'tier', 'data-one-tier', frame.tier);
        _call_onePaintColour();
    }

    function _call_onePaintColour(): void {
        const paint = onePaint(_state_oneColor, _state_oneTheme);
        const wash = _state_oneWash;
        const u = wash ? ui(Math.min(1, Math.max(0, (_state_oneStage.now() - wash.start) / WASH_MS))) : 1;
        if (wash && u >= 1)
            _state_oneWash = null;
        const from = wash && u < 1 ? wash.from : paint;
        const opacity = from.discOpacity + (paint.discOpacity - from.discOpacity) * u;
        _call_oneWrite(_state_oneParts.disc, 'disc', 'fill', mix(from.disc, paint.disc, u));
        _call_oneWrite(_state_oneParts.disc, 'disc-opacity', 'fill-opacity', opacity >= 1 ? null : String(Number(opacity.toFixed(3))));
        if (_state_oneParts.keyline)
            _call_oneWrite(_state_oneParts.keyline, 'keyline', 'stroke-opacity', u >= 1 ? null : String(Number(u.toFixed(3))));
        if (_state_oneParts.rim && paint.rim)
            _call_oneWrite(_state_oneParts.rim, 'rim', 'stroke-opacity', String(Number((paint.rim.opacity * u).toFixed(3))));
        if (paint.eye !== null) {
            const ink = from.eye === null ? paint.eye : mix(from.eye, paint.eye, u);
            _call_oneWrite(_state_oneParts.bar, 'ink', 'fill', ink);
            _call_oneWrite(_state_oneParts.bar, 'ink-stroke', 'stroke', ink);
            _call_oneWrite(_state_oneParts.mouth, 'mouth-ink', 'fill', ink);
        }
    }

    function _call_oneSetStateAttributes(status: string, expression: string): void {
        _stateroot.setAttribute('data-character-status', status);
        _stateroot.setAttribute('data-character-expression', expression);
    }

    function _callsetState(face: OneFace, gaze: { readonly x: number; readonly y: number }, blink: number, status: string, expression: string): void {
        if (_state_oneDisposed)
            return;
        _call_oneSetStateAttributes(status, expression);
        _state_oneSpeaking = status === 'speaking';
        _statemotion.setBlink(blink);
        _statemotion.noteInput(_state_oneStage.inputAt);
        const request = _statemotion.setFace(face, gaze, _state_oneStage.now());
        if (!request) {
            if (!_statemotion.moving)
                _call_onePaint(_statemotion.sample(_state_oneStage.now()).frame);
            if (_state_oneSpeaking)
                _call_oneStartTalk();
            return;
        }
        _call_oneStopCadence();
        _call_oneStopFollow();
        // Since you looked: a hidden head records the change and performs it when it comes into view.
        if (!_statevisible || _state_oneStage.hidden) {
            _statemotion.snap();
            _call_onePaint(_statemotion.sample(_state_oneStage.now()).frame);
            return;
        }
        _state_oneSeen = face;
        _state_oneStage.request(api, request);
    }

    function _callstart(request: OneMomentRequest, at: number): void {
        _statemotion.start(request, at);
        _stateroot.setAttribute('data-moving', '');
    }

    function _callstep(at: number, scrolling: boolean): boolean {
        const playing = _statemotion.timelineEnd !== null;
        const { frame, finished } = _statemotion.sample(at);
        // While a list scrolls, a playing moment advances without writing geometry.
        if (!scrolling || !playing || finished)
            _call_onePaint(frame);
        if (finished) {
            _state_oneStage.release(api);
            if (_state_oneSpeaking)
                _call_oneStartTalk();
            else
                _callscheduleCadence();
        }
        const moving = _statemotion.moving || _state_oneWash !== null;
        if (!moving)
            _stateroot.removeAttribute('data-moving');
        return moving;
    }

    function _call_oneStartTalk(): void {
        if (_statevisible && _statemotion.startTalk(_state_oneStage.now())) {
            _stateroot.setAttribute('data-moving', '');
            _state_oneStage.tick(api);
        }
    }

    function _callpointer(x: number, y: number): void {
        if (!_statevisible || !_getmotionAllowed() || _state_oneStage.hidden)
            return;
        const current = _statemotion.request;
        if (current && !current.uncounted)
            return;
        const tier = oneTier(_state_onePx);
        if (tier !== 'M' && tier !== 'L')
            return;
        const box = _stateroot.getBoundingClientRect();
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        if (Math.hypot(x - cx, y - cy) > FOLLOW_RANGE + box.width / 2) {
            if (_statemotion.following)
                _call_oneEndFollow();
            return;
        }
        const reach = _state_oneStage.reach;
        if (!_statemotion.follow({ x: Math.tanh((x - cx) / reach * 1.4), y: Math.tanh((y - cy) / reach * 1.4) }))
            return;
        _stateroot.setAttribute('data-moving', '');
        _state_oneStage.tick(api);
        const win = _state_oneDoc.defaultView!;
        if (_state_oneFollowTimer)
            win.clearTimeout(_state_oneFollowTimer);
        _state_oneFollowTimer = win.setTimeout(() => { _state_oneFollowTimer = 0; _call_oneEndFollow(); }, FOLLOW_REST_MS);
    }

    function _call_oneEndFollow(): void {
        _call_oneStopFollow();
        if (_statevisible && _getmotionAllowed())
            _state_oneStage.request(api, { name: 'home', priority: 0, uncounted: true });
    }

    function _call_oneStopFollow(): void {
        if (_state_oneFollowTimer)
            _state_oneDoc.defaultView?.clearTimeout(_state_oneFollowTimer);
        _state_oneFollowTimer = 0;
        _statemotion.follow(null);
    }

    function _callscheduleCadence(): void {
        _call_oneStopCadence();
        if (!_statevisible || !_getmotionAllowed() || _state_oneStage.hidden)
            return;
        _statemotion.noteInput(_state_oneStage.inputAt);
        const now = _state_oneStage.now();
        const delay = _statemotion.nextCadence(now);
        if (delay === null) {
            if (_statemotion.cadenceRequest() && _state_oneStage.idle())
                _state_oneStage.waitForInput(api);
            return;
        }
        _state_oneCadenceTimer = _state_oneDoc.defaultView!.setTimeout(() => {
            _state_oneCadenceTimer = 0;
            const request = _statemotion.cadenceRequest();
            if (request && _statevisible)
                _state_oneStage.request(api, request);
        }, delay);
    }

    function _call_oneStopCadence(): void {
        if (_state_oneCadenceTimer)
            _state_oneDoc.defaultView?.clearTimeout(_state_oneCadenceTimer);
        _state_oneCadenceTimer = 0;
        _state_oneStage.stopWaiting(api);
    }

    function _callcutCadence(): void {
        _call_oneStopCadence();
        _callstart({ name: 'settle', priority: 0 }, _state_oneStage.now());
        _state_oneStage.tick(api);
    }

    function _calldrop(): void {
        _statemotion.snap();
        _state_oneWash = null;
        _stateroot.removeAttribute('data-moving');
        _call_onePaint(_statemotion.sample(_state_oneStage.now()).frame, true);
        if (_state_oneSpeaking)
            _call_oneStartTalk();
        else
            _callscheduleCadence();
    }

    function _callplay(name: OneGesture, viewer: boolean): boolean {
        if (_state_oneDisposed || !_getmotionAllowed() || _state_oneStage.hidden)
            return false;
        const tier = _statemotion.tier;
        const big = tier === 'M' || tier === 'L';
        const light = name === 'lookAtYou' || name === 'nod';
        if (tier === 'XS' || (!big && !light))
            return false;
        if (!light && (_statemotion.face === 'attention' || _state_oneSpeaking))
            return false;
        const request: OneMomentRequest = viewer ? { name, priority: 5, user: true } : { name, priority: 3 };
        if (!_statevisible) {
            if (viewer)
                return false;
            _state_oneGesture = { request, at: _state_oneStage.now() };
            return true;
        }
        _state_oneGesture = null;
        _call_oneStopCadence();
        _call_oneStopFollow();
        _state_oneStage.request(api, request);
        return true;
    }

    function _callsnap(): void {
        _call_oneStopCadence();
        _call_oneStopFollow();
        _state_oneStage.cancel(api);
        _statemotion.snap();
        _state_oneWash = null;
        _state_oneGesture = null;
        _stateroot.removeAttribute('data-moving');
        _call_onePaint(_statemotion.sample(_state_oneStage.now()).frame, true);
    }

    function _callsetVisible(visible: boolean): void {
        if (visible === _statevisible)
            return;
        _statevisible = visible;
        if (visible)
            _callshow();
        else
            _callhide();
    }

    function _callshow(): void {
        if (_state_oneDisposed || _state_oneStage.hidden)
            return;
        const gesture = _state_oneGesture;
        _state_oneGesture = null;
        if (!_getmotionAllowed()) {
            _callsnap();
            _state_oneSeen = _statemotion.face;
            return;
        }
        const face = _statemotion.face;
        if (_state_oneSeen !== face) {
            const previous = _state_oneSeen;
            _state_oneSeen = face;
            _state_oneStage.request(api, _statemotion.entrance(previous, face));
            return;
        }
        if (gesture && _state_oneStage.now() - gesture.at <= GESTURE_WAIT_MS) {
            _state_oneStage.request(api, gesture.request);
            return;
        }
        if (_state_oneSpeaking) {
            _call_oneStartTalk();
            return;
        }
        const cadence = _statemotion.cadenceRequest();
        if (cadence) {
            _statemotion.restartWindow(_state_oneStage.now());
            _state_oneStage.request(api, { ...cadence, priority: 1 });
        }
    }

    function _callhide(): void {
        _call_oneStopCadence();
        if (_statemotion.moving || _state_oneWash)
            _callsnap();
        else
            _state_oneStage.cancel(api);
    }

    function _callsetRenderedSize(px: number): void {
        const rounded = Math.round(px);
        if (!Number.isFinite(rounded) || rounded <= 0 || rounded === _state_onePx)
            return;
        const tier = oneTier(_state_onePx) !== oneTier(rounded);
        _state_onePx = rounded;
        _statemotion.setSize(rounded);
        _call_oneKeyline();
        if (tier && !_statemotion.moving)
            _call_onePaint(_statemotion.sample(_state_oneStage.now()).frame);
    }

    function _callsetReduced(reduced: boolean): void {
        _state_oneReduced = reduced;
        _statemotion.setMotion(_getmotionAllowed());
        if (!_getmotionAllowed())
            _callsnap();
        else if (_statevisible) {
            _state_oneSeen = _statemotion.face;
            _callshow();
        }
    }

    function _callsetPaint(kind: OneKind, color: OneHeadColor, theme: OneTheme, size: number, label: string | undefined): void {
        if (color === 'charcoal' ? kind !== 'charcoal' : kind === 'charcoal')
            throw new TypeError(oneError(35, () => ('Digital One is charcoal in shape and colour alike')));
        const recolour = kind !== _state_oneKind || color !== _state_oneColor;
        if (!recolour && theme === _state_oneTheme && label === _state_oneLabel) {
            if (size !== _state_onePx) {
                _stateroot.setAttribute('width', String(size));
                _stateroot.setAttribute('height', String(size));
                _callsetRenderedSize(size);
            }
            return;
        }
        const before = onePaint(_state_oneColor, _state_oneTheme);
        const firstBlink = _state_oneColor === 'blank' && color !== 'blank';
        _state_oneKind = kind;
        _state_oneColor = color;
        _state_oneTheme = theme;
        _state_oneLabel = label;
        _state_onePx = size;
        _statemotion.setSize(size);
        _statemotion.setKind(kind);
        const previous = _stateroot;
        _call_oneBuild();
        for (const name of ['data-character-status', 'data-character-expression', 'data-moving'] as const) {
            const value = previous.getAttribute(name);
            if (value !== null)
                _stateroot.setAttribute(name, value);
        }
        previous.replaceWith(_stateroot);
        _state_oneStage.replaced(previous, api);
        if (!recolour || !_statevisible || !_getmotionAllowed())
            return;
        if (firstBlink && _statemotion.tier !== 'XS') {
            _state_oneWash = { from: before, start: _state_oneStage.now() };
            _call_onePaintColour();
            _state_oneStage.request(api, { name: 'firstBlink', priority: 7, user: true });
        }
        else if (_statemotion.tier === 'M' || _statemotion.tier === 'L') {
            _state_oneStage.request(api, { name: 'wave', priority: 4, user: true });
        }
    }

    function _calldispose(): void {
        if (_state_oneDisposed)
            return;
        _state_oneDisposed = true;
        _call_oneStopCadence();
        _call_oneStopFollow();
        _state_oneStage.remove(api);
        _stateroot.remove();
    }
    const api: OneHead = {
      get root() { return _stateroot; }, set root(value: SVGSVGElement) { _stateroot = value; },
      get motion() { return _statemotion; },
      get group() { return _stategroup; },
      get follows() { return _statefollows; },
      get visible() { return _statevisible; }, set visible(value: boolean) { _statevisible = value; },
      get motionAllowed() { return _getmotionAllowed(); },
      setState: _callsetState,
      start: _callstart,
      step: _callstep,
      pointer: _callpointer,
      scheduleCadence: _callscheduleCadence,
      cutCadence: _callcutCadence,
      drop: _calldrop,
      play: _callplay,
      snap: _callsnap,
      setVisible: _callsetVisible,
      show: _callshow,
      hide: _callhide,
      setRenderedSize: _callsetRenderedSize,
      setReduced: _callsetReduced,
      setPaint: _callsetPaint,
      dispose: _calldispose
    };
    Object.setPrototypeOf(api, new.target.prototype);

    _state_oneDoc = host.ownerDocument!;
    const win = _state_oneDoc.defaultView!;
    _state_oneStage = OneStage.for(win);
    if (options.color === 'charcoal' ? options.kind !== 'charcoal' : options.kind === 'charcoal')
        throw new TypeError(oneError(36, () => ('Digital One is charcoal in shape and colour alike')));
    _state_oneKind = options.kind;
    _state_oneColor = options.color;
    _state_oneTheme = options.theme;
    _state_oneLabel = options.label;
    _state_onePx = options.size;
    _state_oneSpeaking = options.speaking;
    _state_oneReduced = options.reduced;
    _state_oneAnimated = options.animated;
    _statefollows = options.follow === true;
    _state_oneSeen = options.face;
    _state_oneInstance = 'oaid-one-' + Array.from(win.crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16)).join('-');
    _stategroup = options.group ?? host.closest(LIST_CONTAINERS) ?? api;
    _statemotion = new OneMotion({ face: options.face, gaze: options.gaze, px: _state_onePx,
        kind: _state_oneKind, random: options.random, cadence: options.cadence,
        ...(options.voiceLevel ? { level: options.voiceLevel } : {}), motion: _getmotionAllowed(), at: _state_oneStage.now() });
    _statemotion.setBlink(options.blink);
    _call_oneBuild();
    _call_oneSetStateAttributes(options.status, options.expression);
    // A still One rendered on the server for this element is replaced in place, so hydration never adds a second head.
    const still = Array.from(host.children).find(child => child.localName === 'svg' &&
        child.getAttribute('data-character-skin') === 'one' && !child.hasAttribute('data-character-player'));
    if (still)
        still.replaceWith(_stateroot);
    else
        host.append(_stateroot);
    _state_oneStage.add(api);

    return api;
  }
}
