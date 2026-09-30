type Tone = {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
  attack?: number;
};

const MUSIC_BPM = 112;
// Bouncy I–vi–IV–V progression in C with a walking bass and a pentatonic lead.
const CHORDS = [
  [261.63, 329.63, 392.0],
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66],
];
const BASS = [130.81, 110.0, 87.31, 98.0];
const LEAD = [523.25, 587.33, 659.25, 783.99, 880.0, 783.99, 659.25, 587.33];

/** Procedural Web Audio SFX + a light music loop. Unlocks on first user gesture. */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sizzleGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicOn = false;
  muted = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get unlocked(): boolean {
    return this.context?.state === 'running';
  }

  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state !== 'running') await this.context.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.16;
    this.musicBus.connect(this.master);

    const len = ctx.sampleRate * 1.5;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'highpass';
    band.frequency.value = 3200;
    this.sizzleGain = ctx.createGain();
    this.sizzleGain.gain.value = 0;
    noise.connect(band).connect(this.sizzleGain).connect(this.sfxBus);
    noise.start();
    await ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.context.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on && this.context) this.nextNoteTime = this.context.currentTime + 0.05;
  }

  /** 0..1 intensity of frying on the player's side. */
  setSizzle(level: number): void {
    if (!this.sizzleGain || !this.context) return;
    this.sizzleGain.gain.setTargetAtTime(level * 0.05, this.context.currentTime, 0.2);
  }

  update(): void {
    if (!this.context || !this.musicOn || this.context.state !== 'running') return;
    const stepDur = 60 / MUSIC_BPM / 2;
    while (this.nextNoteTime < this.context.currentTime + 0.2) {
      this.scheduleStep(this.musicStep, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 64;
    }
    this.musicTimer += 1;
  }

  private scheduleStep(step: number, time: number, dur: number): void {
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    const chord = CHORDS[bar];
    if (beat % 4 === 0) this.note('triangle', BASS[bar] * (beat % 8 === 0 ? 1 : 1.5), time, dur * 1.8, 0.5, this.musicBus);
    if (beat % 4 === 2) chord.forEach((f) => this.note('sine', f, time, dur * 0.9, 0.12, this.musicBus));
    if (beat % 2 === 0 && (step * 7) % 5 !== 0) {
      this.note('square', LEAD[(step * 3 + bar) % LEAD.length], time, dur * 0.7, 0.04, this.musicBus);
    }
    if (beat % 4 === 0) this.hat(time, 0.05);
  }

  private note(type: OscillatorType, freq: number, time: number, dur: number, gain: number, bus: GainNode | null): void {
    if (!this.context || !bus) return;
    const osc = this.context.createOscillator();
    const g = this.context.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private hat(time: number, gain: number): void {
    if (!this.context || !this.noiseBuffer || !this.musicBus) return;
    const src = this.context.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.context.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.context.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(time, Math.random());
    src.stop(time + 0.06);
  }

  private tones(list: Tone[]): void {
    if (!this.context || !this.sfxBus || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    for (const t of list) {
      const start = now + (t.delay ?? 0);
      const osc = this.context.createOscillator();
      const g = this.context.createGain();
      osc.type = t.type ?? 'triangle';
      osc.frequency.setValueAtTime(t.from, start);
      if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(t.gain ?? 0.15, start + (t.attack ?? 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
      osc.connect(g).connect(this.sfxBus);
      osc.start(start);
      osc.stop(start + t.dur + 0.02);
    }
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    if (!this.context || !this.noiseBuffer || !this.sfxBus || this.context.state !== 'running') return;
    const start = this.context.currentTime + delay;
    const src = this.context.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const g = this.context.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.02);
  }

  grab(): void {
    this.tones([{ from: 420, to: 720, dur: 0.1, gain: 0.12 }]);
  }
  place(): void {
    this.tones([{ from: 520, to: 300, dur: 0.1, gain: 0.12 }]);
    this.noise(0.05, 1800, 0.08);
  }
  plateAdd(): void {
    this.tones([
      { from: 660, dur: 0.08, gain: 0.1 },
      { from: 990, dur: 0.12, gain: 0.08, delay: 0.05 },
    ]);
  }
  chop(): void {
    this.noise(0.06, 2400, 0.25);
    this.tones([{ type: 'square', from: 180, to: 90, dur: 0.05, gain: 0.05 }]);
  }
  chopDone(): void {
    this.tones([
      { from: 784, dur: 0.1, gain: 0.1 },
      { from: 1175, dur: 0.16, gain: 0.1, delay: 0.07 },
    ]);
  }
  ding(): void {
    this.tones([
      { type: 'sine', from: 1318, dur: 0.6, gain: 0.14 },
      { type: 'sine', from: 1975, dur: 0.4, gain: 0.05 },
    ]);
  }
  alarm(): void {
    this.tones([
      { type: 'square', from: 880, dur: 0.09, gain: 0.06 },
      { type: 'square', from: 880, dur: 0.09, gain: 0.06, delay: 0.16 },
      { type: 'square', from: 880, dur: 0.09, gain: 0.06, delay: 0.32 },
    ]);
  }
  burnt(): void {
    this.noise(0.6, 900, 0.3, 'lowpass');
    this.tones([{ type: 'sawtooth', from: 220, to: 110, dur: 0.4, gain: 0.06 }]);
  }
  serve(): void {
    this.tones([
      { from: 784, dur: 0.1, gain: 0.12 },
      { from: 988, dur: 0.1, gain: 0.12, delay: 0.08 },
      { from: 1318, dur: 0.25, gain: 0.14, delay: 0.16 },
    ]);
    this.noise(0.2, 6000, 0.08, 'highpass', 0.16);
  }
  wrong(): void {
    this.tones([
      { type: 'square', from: 200, to: 150, dur: 0.18, gain: 0.07 },
      { type: 'square', from: 150, to: 110, dur: 0.22, gain: 0.07, delay: 0.14 },
    ]);
  }
  deny(): void {
    this.tones([{ type: 'square', from: 160, to: 120, dur: 0.08, gain: 0.04 }]);
  }
  trash(): void {
    this.noise(0.25, 500, 0.3, 'lowpass');
  }
  newOrder(): void {
    this.tones([
      { type: 'sine', from: 1568, dur: 0.25, gain: 0.08 },
      { type: 'sine', from: 2093, dur: 0.35, gain: 0.06, delay: 0.1 },
    ]);
  }
  expired(): void {
    this.tones([
      { from: 440, to: 330, dur: 0.25, gain: 0.1 },
      { from: 330, to: 220, dur: 0.35, gain: 0.1, delay: 0.2 },
    ]);
  }
  dash(): void {
    this.noise(0.18, 1200, 0.15);
  }
  beep(final = false): void {
    this.tones([{ type: 'square', from: final ? 1046 : 660, dur: final ? 0.4 : 0.15, gain: 0.08 }]);
  }
  victory(): void {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tones([{ from: f, dur: 0.22, gain: 0.12, delay: i * 0.12 }]));
  }
  defeat(): void {
    [392, 370, 349, 262].forEach((f, i) => this.tones([{ type: 'sawtooth', from: f, dur: 0.35, gain: 0.05, delay: i * 0.22 }]));
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}
