import GUI from 'lil-gui';

export type DebugTuning = {
  speed: number;
  acceleration: number;
  dashSpeed: number;
  botSpeed: number;
  botChopRate: number;
  exposure: number;
  maxDpr: number;
};

/** lil-gui panel, only with ?debug in the URL. */
export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Kitchen tuning' });
    this.gui.add(tuning, 'speed', 2, 8, 0.1);
    this.gui.add(tuning, 'acceleration', 4, 30, 0.5);
    this.gui.add(tuning, 'dashSpeed', 4, 18, 0.5);
    this.gui.add(tuning, 'botSpeed', 1, 8, 0.1);
    this.gui.add(tuning, 'botChopRate', 0.2, 2, 0.05);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
