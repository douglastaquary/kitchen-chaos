type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/** Fullscreen + landscape handling for phones and tablets. */
export class MobileScreen {
  readonly touch: boolean;
  private readonly doc = document as FullscreenDoc;
  private readonly root = document.documentElement as FullscreenEl;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.touch = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.touch);
    document.body.classList.toggle('standalone', this.standalone);
    document.body.classList.toggle('no-fullscreen', !this.canFullscreen);
    const notify = () => {
      document.body.classList.toggle('is-fullscreen', this.isFullscreen);
      for (const fn of this.listeners) fn();
    };
    document.addEventListener('fullscreenchange', notify);
    document.addEventListener('webkitfullscreenchange', notify);
    window.matchMedia('(orientation: portrait)').addEventListener?.('change', notify);
    window.addEventListener('resize', notify);
  }

  get canFullscreen(): boolean {
    return !!(this.root.requestFullscreen || this.root.webkitRequestFullscreen);
  }

  get isFullscreen(): boolean {
    return !!(this.doc.fullscreenElement || this.doc.webkitFullscreenElement) || this.standalone;
  }

  /** Launched from the home screen (PWA), which is already fullscreen. */
  get standalone(): boolean {
    return window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  }

  get portrait(): boolean {
    return this.touch && window.innerHeight > window.innerWidth;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** Must run inside a user gesture. Failures are expected on iPhone and are ignored. */
  async enterLandscapeFullscreen(): Promise<void> {
    if (!this.touch) return;
    try {
      if (!this.isFullscreen) {
        if (this.root.requestFullscreen) await this.root.requestFullscreen({ navigationUI: 'hide' });
        else await this.root.webkitRequestFullscreen?.();
      }
    } catch {
      /* not allowed here */
    }
    try {
      await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
    } catch {
      /* orientation lock is Android-only */
    }
  }

  async toggleFullscreen(): Promise<void> {
    if (this.doc.fullscreenElement || this.doc.webkitFullscreenElement) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await this.doc.webkitExitFullscreen?.();
      } catch {
        /* ignore */
      }
      return;
    }
    await this.enterLandscapeFullscreen();
  }
}
