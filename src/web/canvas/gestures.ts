import type { Engine } from './engine';

// Pointer behaviour validated in the canvas POC, observed in the capture phase so it never blocks
// the engine's own gestures (pinch zoom, two-finger pan):
// - pen-down tracking, so nothing in the interface re-renders or moves during a stroke;
// - on a locked canvas the pen (or mouse) does nothing and a short explanation follows on lift;
// - once a pen has been seen, one finger pans instead of drawing;
// - two-finger tap undoes, three-finger tap redoes.

export interface GestureHandlers {
  penSeen(): boolean;
  strokeStart(): void;
  strokeEnd(): void;
  lockedAttempt(): void;
  tapUndo(): void;
  tapRedo(): void;
}

const TAP_MS = 320;
const TAP_SLOP = 14;

export function attachGestures(engine: Engine, element: HTMLElement, handlers: GestureHandlers) {
  const cleanup: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window | Document,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options: AddEventListenerOptions | boolean = true,
  ) => {
    target.addEventListener(type, listener as EventListener, options);
    cleanup.push(() => target.removeEventListener(type, listener as EventListener, options));
  };

  let spaceHeld = false;
  on(window, 'keydown', (event) => {
    if (event.code === 'Space') spaceHeld = true;
  });
  on(window, 'keyup', (event) => {
    if (event.code === 'Space') spaceHeld = false;
  });
  on(window, 'blur', () => (spaceHeld = false));

  // Strokes and the locked canvas.
  let down = false;
  let blocked = false;
  on(element, 'pointerdown', (event) => {
    const stroke =
      event.pointerType === 'pen' ||
      (event.pointerType === 'mouse' && event.button === 0) ||
      (event.pointerType === 'touch' && !handlers.penSeen());
    if (!stroke || spaceHeld || event.button === 1) return;
    if (engine.isLocked && event.pointerType !== 'touch') {
      event.stopPropagation();
      event.preventDefault();
      blocked = true;
    }
    down = true;
    handlers.strokeStart();
  });
  const up = () => {
    if (!down) return;
    down = false;
    handlers.strokeEnd();
    if (blocked) handlers.lockedAttempt();
    blocked = false;
  };
  on(window, 'pointerup', up);
  on(window, 'pointercancel', up);

  // One-finger pan while the pen draws.
  const touches = new Set<number>();
  let pan: { id: number; x: number; y: number } | null = null;
  on(element, 'pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    touches.add(event.pointerId);
    pan =
      touches.size === 1 && handlers.penSeen()
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
  });
  on(element, 'pointermove', (event) => {
    if (!pan || event.pointerId !== pan.id || touches.size !== 1) return;
    const camera = engine.getCamera();
    engine.setCamera({
      x: camera.x + event.clientX - pan.x,
      y: camera.y + event.clientY - pan.y,
      z: camera.z,
    });
    pan.x = event.clientX;
    pan.y = event.clientY;
  });
  const touchEnd = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    touches.delete(event.pointerId);
    pan = null;
  };
  on(element, 'pointerup', touchEnd);
  on(element, 'pointercancel', touchEnd);

  // Multi-finger taps.
  const fingers = new Set<number>();
  let tap: {
    start: number;
    most: number;
    moved: number;
    origin: Map<number, [number, number]>;
  } | null = null;
  on(element, 'pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    fingers.add(event.pointerId);
    tap ??= { start: performance.now(), most: 0, moved: 0, origin: new Map() };
    tap.origin.set(event.pointerId, [event.clientX, event.clientY]);
    tap.most = Math.max(tap.most, fingers.size);
  });
  on(element, 'pointermove', (event) => {
    const origin = tap?.origin.get(event.pointerId);
    if (!tap || !origin) return;
    tap.moved = Math.max(
      tap.moved,
      Math.hypot(event.clientX - origin[0], event.clientY - origin[1]),
    );
  });
  const tapEnd = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    fingers.delete(event.pointerId);
    if (fingers.size || !tap) return;
    const quick = performance.now() - tap.start < TAP_MS && tap.moved < TAP_SLOP;
    if (quick && tap.most === 2) handlers.tapUndo();
    else if (quick && tap.most >= 3) handlers.tapRedo();
    tap = null;
  };
  on(element, 'pointerup', tapEnd);
  on(element, 'pointercancel', tapEnd);

  // Safari's page pinch would zoom the whole interface instead of the canvas.
  on(document, 'gesturestart' as keyof HTMLElementEventMap, (event) => event.preventDefault(), {
    passive: false,
  });

  return () => cleanup.forEach((stop) => stop());
}
