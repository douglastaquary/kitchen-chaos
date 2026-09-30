import * as THREE from 'three';

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
};

const INTERACT_KEYS = new Set(['KeyE', 'Space', 'KeyJ', 'Enter']);
const WORK_KEYS = new Set(['KeyF', 'KeyK', 'ControlLeft', 'ControlRight']);
const DASH_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyL']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/** Keyboard + touch → game intents. Press intents are latched until consumed once per frame. */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly pointer = new THREE.Vector2();
  private readonly keyVector = new THREE.Vector2();
  private readonly pointerState: PointerState = { active: false, id: null, centerX: 0, centerY: 0, radius: 1 };
  private interactLatch = false;
  private dashLatch = false;
  private pauseLatch = false;
  private touchWork = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    stick: HTMLElement,
    private readonly knob: HTMLElement,
    buttons: { grab: HTMLElement; chop: HTMLElement; dash: HTMLElement },
  ) {
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) {
        if (WORK_KEYS.has(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (INTERACT_KEYS.has(e.code)) this.interactLatch = true;
      if (DASH_KEYS.has(e.code)) this.dashLatch = true;
      if (PAUSE_KEYS.has(e.code)) this.pauseLatch = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    this.on(stick, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      const rect = stick.getBoundingClientRect();
      this.pointerState.active = true;
      this.pointerState.id = e.pointerId;
      this.pointerState.centerX = rect.left + rect.width / 2;
      this.pointerState.centerY = rect.top + rect.height / 2;
      this.pointerState.radius = rect.width * 0.42;
      try {
        stick.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic test events do not always have a capturable pointer id.
      }
      this.updatePointer(e.clientX, e.clientY);
    });
    this.on(stick, 'pointermove', (e: PointerEvent) => {
      if (!this.pointerState.active || e.pointerId !== this.pointerState.id) return;
      e.preventDefault();
      this.updatePointer(e.clientX, e.clientY);
    });
    const stickUp = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerState.id) return;
      this.resetStick();
    };
    this.on(stick, 'pointerup', stickUp);
    this.on(stick, 'pointercancel', stickUp);
    this.on(stick, 'lostpointercapture', stickUp);

    this.bindButton(buttons.grab, () => (this.interactLatch = true));
    this.bindButton(buttons.dash, () => (this.dashLatch = true));
    this.bindButton(
      buttons.chop,
      () => (this.touchWork = true),
      () => (this.touchWork = false),
    );
  }

  readMovement(target: THREE.Vector2): THREE.Vector2 {
    this.keyVector.set(0, 0);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.keyVector.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.keyVector.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.keyVector.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.keyVector.y += 1;
    target.copy(this.keyVector).add(this.pointer);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  consumeInteract(): boolean {
    const v = this.interactLatch;
    this.interactLatch = false;
    return v;
  }

  consumeDash(): boolean {
    const v = this.dashLatch;
    this.dashLatch = false;
    return v;
  }

  consumePause(): boolean {
    const v = this.pauseLatch;
    this.pauseLatch = false;
    return v;
  }

  isWorkHeld(): boolean {
    if (this.touchWork) return true;
    for (const k of WORK_KEYS) if (this.keys.has(k)) return true;
    return false;
  }

  /** Drop latched presses (e.g. when a menu consumed them). */
  flush(): void {
    this.interactLatch = false;
    this.dashLatch = false;
    this.pauseLatch = false;
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.touchWork = false;
    this.resetStick();
  }

  private resetStick(): void {
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.pointer.set(0, 0);
    this.updateKnob();
  }

  private bindButton(el: HTMLElement, down: () => void, up?: () => void): void {
    this.on(el, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      el.classList.add('pressed');
      down();
    });
    const release = () => {
      el.classList.remove('pressed');
      up?.();
    };
    this.on(el, 'pointerup', release);
    this.on(el, 'pointercancel', release);
    this.on(el, 'pointerleave', release);
  }

  private on<K extends Event>(target: EventTarget, type: string, handler: (e: K) => void): void {
    const fn = handler as EventListener;
    target.addEventListener(type, fn, { passive: false });
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private updatePointer(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerState.centerX;
    const dy = clientY - this.pointerState.centerY;
    this.pointer.set(dx / this.pointerState.radius, dy / this.pointerState.radius);
    if (this.pointer.lengthSq() > 1) this.pointer.normalize();
    this.updateKnob();
  }

  private updateKnob(): void {
    const distance = 38;
    this.knob.style.transform = `translate(calc(-50% + ${this.pointer.x * distance}px), calc(-50% + ${this.pointer.y * distance}px))`;
  }
}
