import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import { IconRenderer } from '../assets/IconRenderer';
import { ItemVisuals } from '../assets/ItemVisuals';
import { batchStatic } from '../assets/StaticBatcher';
import { createContactShadowTexture } from '../assets/Textures';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { AudioSystem } from '../systems/AudioSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type ScreenName } from '../systems/Hud';
import { Vfx } from '../systems/Vfx';
import { createSeededRandom } from '../utils/random';
import { BotBrain } from './BotBrain';
import { Chef } from './Chef';
import { buildEnvironment, buildLights } from './Environment';
import {
  RECIPES,
  RECIPE_ORDER,
  emptyPlate,
  ingredient,
  type Ingredient,
  type Item,
  type PlatePart,
} from './Items';
import { Kitchen } from './Kitchen';
import { BOT_SPAWN, GRID_H, GRID_W, PLAYER_SPAWN, tileToWorld } from './Layout';
import { MATCH_LENGTH, OrderBook, buildSchedule, type OrderEvent } from './Orders';
import type { Station, StationEvent } from './Stations';

type Phase = 'loading' | 'title' | 'countdown' | 'playing' | 'paused' | 'results';

const PLAYER_NAME = 'You';
const BOT_NAME = 'BrandynBot';
const CAMERA_PITCH = THREE.MathUtils.degToRad(60);
const COUNTDOWN_STEP = 0.8;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  private readonly input: InputController;
  private readonly hud = new Hud();
  private readonly audio = new AudioSystem();
  private readonly vfx = new Vfx();
  private readonly lib = new AssetLibrary();
  private readonly loop = new Loop(
    (delta) => this.update(delta),
    () => this.render(),
  );
  private readonly tuning: DebugTuning = {
    speed: 4.7,
    acceleration: 18,
    dashSpeed: 11,
    botSpeed: 3.7,
    botChopRate: 0.8,
    exposure: 1.0,
    maxDpr: 2,
  };
  private readonly debugTools: DebugTools;

  private kitchen: Kitchen | null = null;
  private player: Chef | null = null;
  private bot: Chef | null = null;
  private brain: BotBrain | null = null;
  /** `?autoplay` drives the player chef with the same planner (used by the bot playtest). */
  private autopilot: BotBrain | null = null;
  private playerOrders = new OrderBook([]);
  private botOrders = new OrderBook([]);
  private icons: IconRenderer | null = null;
  private portraits = { player: '', bot: '' };
  private nameTags: { chef: Chef; el: HTMLElement }[] = [];

  private phase: Phase = 'loading';
  private matchTime = 0;
  private countdownTime = 0;
  private frame = 0;
  private time = 0;
  private rng = createSeededRandom(7);
  private seedValue = 7;
  private pausedForScreenshot = false;
  private chopSoundTimer = 0;
  private emitTimer = 0;
  private lastOutcome: 'win' | 'lose' | 'draw' | null = null;
  private cameraKey = '';
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpMove = new THREE.Vector2();
  private readonly shadows: THREE.Mesh[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = this.tuning.exposure;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    this.input = new InputController(getEl('#touch-stick'), getEl('#touch-knob'), {
      grab: getEl('#grab-button'),
      chop: getEl('#chop-button'),
      dash: getEl('#dash-button'),
    });
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      this.cameraKey = '';
    });

    if (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');

    buildLights(this.scene);
    this.vfx.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.scene.add(this.vfx.group);
    this.bindUi();
    this.installTestHooks();
    this.hud.showScreen('title');
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
    void this.load();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.icons?.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ---------- Loading ----------

  private readyPromise: Promise<void> | null = null;

  private load(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.loadInner();
    return this.readyPromise;
  }

  private async loadInner(): Promise<void> {
    try {
      await this.lib.load(`${import.meta.env.BASE_URL}assets/kitchen.glb`, (f) => this.hud.setLoadProgress(f * 0.9));
    } catch (error) {
      console.error(error);
      this.hud.setLoadError('Could not load the kitchen :(');
      throw error;
    }
    await document.fonts?.ready;
    const visuals = new ItemVisuals(this.lib);
    const icons = new IconRenderer(128);
    this.icons = icons;
    this.bakeIcons(icons, visuals);

    const env = buildEnvironment(this.lib);
    this.scene.add(env);
    const kitchen = new Kitchen(this.lib, visuals, icons);
    this.kitchen = kitchen;
    this.scene.add(kitchen.group);
    const envBatch = batchStatic(env);
    const kitchenBatch = batchStatic(kitchen.group);
    this.batchInfo = `env ${envBatch.before}->${envBatch.after}, kitchen ${kitchenBatch.before}->${kitchenBatch.after}`;

    this.player = new Chef('player', PLAYER_NAME, this.lib, visuals, PLAYER_SPAWN, '#3cc4b0');
    this.bot = new Chef('bot', BOT_NAME, this.lib, visuals, BOT_SPAWN, '#f25b5b');
    this.bot.facing.set(0, 1);
    this.scene.add(this.player.group, this.bot.group);
    this.nameTags = [
      { chef: this.player, el: this.hud.createNameTag('maxchef (you)', false) },
      { chef: this.bot, el: this.hud.createNameTag(BOT_NAME, true) },
    ];
    for (const chef of [this.player, this.bot]) this.addContactShadow(chef.group, 0.95);

    this.brain = new BotBrain(
      this.bot,
      kitchen,
      this.botOrders,
      { reactionMin: 0.3, reactionMax: 0.65, chopRate: this.tuning.botChopRate },
      createSeededRandom(this.seedValue + 99),
    );
    if (new URLSearchParams(window.location.search).has('autoplay')) {
      this.autopilot = new BotBrain(
        this.player,
        kitchen,
        this.playerOrders,
        { reactionMin: 0.15, reactionMax: 0.3, chopRate: 1 },
        createSeededRandom(this.seedValue + 5),
      );
    }

    this.hud.setIcons(icons);
    for (const id of RECIPE_ORDER) icons.url(`dish:${id}`);
    icons.dispose();
    this.hud.setReady(this.portraits.player, this.portraits.bot);
    this.hud.setLoadProgress(1);
    this.phase = 'title';
    this.cameraKey = '';
    this.publishDiagnostics();
  }

  private bakeIcons(icons: IconRenderer, visuals: ItemVisuals): void {
    for (const id of RECIPE_ORDER) {
      icons.render(`dish:${id}`, visuals.build({ kind: 'plate', parts: [...RECIPES[id].parts] as PlatePart[] }));
    }
    const raw: [string, string][] = [
      ['bun', 'bun'],
      ['patty', 'patty_raw'],
      ['lettuce', 'lettuce'],
      ['tomato', 'tomato'],
      ['noodles', 'noodles'],
    ];
    for (const [key, asset] of raw) icons.render(`raw:${key}`, this.lib.clone(asset));
    icons.render('chef:player', this.lib.clone('chef_player'));
    icons.render('chef:bot', this.lib.clone('chef_bot'));
    this.portraits = { player: icons.url('chef:player'), bot: icons.url('chef:bot') };
  }

  private addContactShadow(parent: THREE.Object3D, size: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: createContactShadowTexture(), transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.008;
    parent.add(mesh);
    this.shadows.push(mesh);
  }

  // ---------- UI ----------

  private bindUi(): void {
    getEl('#play-button').addEventListener('click', () => this.startMatch());
    getEl('#rematch-button').addEventListener('click', () => this.startMatch());
    getEl('#lobby-button').addEventListener('click', () => this.toTitle());
    getEl('#quit-button').addEventListener('click', () => this.toTitle());
    getEl('#resume-button').addEventListener('click', () => this.setPaused(false));
    getEl('#restart-button').addEventListener('click', () => this.startMatch());
    getEl('#pause-button').addEventListener('click', () => this.setPaused(true));
    getEl('#mute-button').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.hud.setMuteLabel(this.audio.muted);
    });
  }

  private setScreen(name: ScreenName): void {
    this.hud.showScreen(name);
    this.cameraKey = '';
  }

  private toTitle(): void {
    this.resetMatch();
    this.phase = 'title';
    this.audio.setMusic(false);
    this.setScreen('title');
  }

  private setPaused(paused: boolean): void {
    if (paused && this.phase === 'playing') {
      this.phase = 'paused';
      this.setScreen('paused');
      getEl('#resume-button').focus();
    } else if (!paused && this.phase === 'paused') {
      this.phase = 'playing';
      this.setScreen('playing');
      this.input.flush();
    }
  }

  private resetMatch(): void {
    if (!this.kitchen || !this.player || !this.bot || !this.brain) return;
    this.rng = createSeededRandom(this.seedValue);
    const schedule = buildSchedule(this.rng);
    this.playerOrders.reset(schedule.map((s) => ({ ...s })));
    this.botOrders.reset(schedule.map((s) => ({ ...s })));
    this.kitchen.reset();
    this.player.reset();
    this.bot.reset();
    this.brain.reset(createSeededRandom(this.seedValue + 99));
    this.autopilot?.reset(createSeededRandom(this.seedValue + 5));
    this.vfx.setRandom(createSeededRandom(this.seedValue + 7));
    this.vfx.clear();
    this.matchTime = 0;
    this.lastOutcome = null;
    this.hud.reset();
    this.hud.update([], [], this.playerOrders.stats, this.botOrders.stats, MATCH_LENGTH, MATCH_LENGTH, 0);
  }

  private startMatch(): void {
    if (this.phase === 'loading' || !this.kitchen) return;
    void this.audio.unlock();
    this.resetMatch();
    this.phase = 'countdown';
    this.countdownTime = 0;
    this.setScreen('countdown');
    this.hud.countdown('3');
    this.audio.beep();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // ---------- Update ----------

  private readonly gpuName: string;
  private batchInfo = '';
  private fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsLast = performance.now();

  private update(delta: number): void {
    this.frame += 1;
    this.fpsFrames += 1;
    const now = performance.now();
    this.fpsAccum = now - this.fpsLast;
    if (this.fpsAccum > 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccum);
      this.fpsFrames = 0;
      this.fpsLast = now;
      // Adaptive resolution: step the DPR cap down on slow GPUs during play.
      if (this.phase === 'playing' && this.fps < 45 && this.tuning.maxDpr > 1) {
        this.tuning.maxDpr = Math.max(1, this.tuning.maxDpr - 0.25);
      }
    }
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.fitCamera();
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    this.time += delta;
    this.audio.update();

    if (this.input.consumePause()) {
      if (this.phase === 'playing') this.setPaused(true);
      else if (this.phase === 'paused') this.setPaused(false);
    }

    if (this.phase === 'countdown') this.updateCountdown(delta);
    if (this.phase === 'playing') this.updateMatch(delta);
    else this.input.flush();

    if (this.kitchen && this.player && this.bot) {
      if (this.phase !== 'playing') {
        // Keep idle chefs breathing on menus.
        this.player.clearIntent();
        this.bot.clearIntent();
        if (this.phase !== 'paused') {
          this.player.update(delta, this.kitchen, this.chefTuning(true), this.bot);
          this.bot.update(delta, this.kitchen, this.chefTuning(false), this.player);
        }
      }
      this.kitchen.sync(this.time);
      this.kitchen.animate(delta);
      const showHighlight = this.phase === 'playing' || this.phase === 'countdown';
      this.kitchen.setHighlight(0, showHighlight ? this.player.target : null, this.time);
      this.kitchen.setHighlight(1, null, this.time);
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.hud.update(
          this.playerOrders.orders,
          this.botOrders.orders,
          this.playerOrders.stats,
          this.botOrders.stats,
          MATCH_LENGTH - this.matchTime,
          MATCH_LENGTH,
          delta,
        );
      }
    }
    if (this.phase !== 'paused') this.vfx.update(delta);
    this.updateNameTags();
    this.publishDiagnostics();
  }

  private updateCountdown(delta: number): void {
    const before = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    this.countdownTime += delta;
    const after = Math.floor(this.countdownTime / COUNTDOWN_STEP);
    if (after === before) return;
    if (after < 3) {
      this.hud.countdown(String(3 - after));
      this.audio.beep();
    } else if (after === 3) {
      this.hud.countdown('Cook!');
      this.audio.beep(true);
    } else {
      this.phase = 'playing';
      this.setScreen('playing');
      this.audio.setMusic(true);
      this.input.flush();
    }
  }

  private chefTuning(isPlayer: boolean) {
    return {
      speed: isPlayer ? this.tuning.speed : this.tuning.botSpeed,
      acceleration: this.tuning.acceleration,
      dashSpeed: this.tuning.dashSpeed,
    };
  }

  private updateMatch(delta: number): void {
    const kitchen = this.kitchen!;
    const player = this.player!;
    const bot = this.bot!;

    this.matchTime += delta;

    const move = this.input.readMovement(this.tmpMove);
    player.intent.moveX = move.x;
    player.intent.moveZ = move.y;
    player.intent.interact = this.input.consumeInteract();
    player.intent.work = this.input.isWorkHeld();
    player.intent.dash = this.input.consumeDash();
    if (this.autopilot) this.autopilot.update(delta);
    this.brain!.update(delta);

    player.update(delta, kitchen, this.chefTuning(true), bot);
    bot.update(delta, kitchen, this.chefTuning(false), player);

    for (const chef of [player, bot]) {
      if (chef.dashStarted) {
        this.vfx.puff(chef.position);
        if (chef === player) this.audio.dash();
      }
      if (chef.intent.interact) this.handleInteract(chef);
      this.handleWork(chef, delta);
    }

    for (const station of kitchen.stations) {
      const ev = station.update(delta);
      if (ev) this.onStationTick(station, ev);
    }
    this.emitAmbient(delta);

    const events: OrderEvent[] = [];
    this.playerOrders.update(this.matchTime, delta, events);
    for (const e of events) this.onOrderEvent(e, true);
    events.length = 0;
    this.botOrders.update(this.matchTime, delta, events);

    if (this.matchTime >= MATCH_LENGTH) this.endMatch();
  }

  private handleInteract(chef: Chef): void {
    const station = chef.target;
    const isPlayer = chef.id === 'player';
    if (!station) {
      if (isPlayer) this.audio.deny();
      return;
    }
    if (station.def.owner !== chef.id && station.def.owner !== 'shared') {
      if (isPlayer) {
        this.audio.deny();
        this.floatAt(this.kitchen!.worldTop(station, this.tmpV), 'Not your kitchen!', 'info');
      }
      chef.bump(0.2);
      return;
    }
    const before = chef.held;
    const result = station.interact(chef.held);
    chef.setHeld(result.held);
    for (const ev of result.events) this.onStationEvent(chef, station, ev, before);
  }

  private onStationEvent(chef: Chef, station: Station, ev: StationEvent, before: Item | null): void {
    const isPlayer = chef.id === 'player';
    const top = this.kitchen!.worldTop(station, this.tmpV);
    switch (ev.type) {
      case 'pickup':
        if (isPlayer) this.audio.grab();
        chef.bump(0.2);
        break;
      case 'place':
      case 'potAdd':
        if (isPlayer) this.audio.place();
        if (ev.type === 'potAdd') this.vfx.emit(top, { count: 8, color: '#bfe8ff', speed: [0.5, 1], up: [1, 2], life: [0.3, 0.5], size: [0.08, 0.04], gravity: -6 });
        break;
      case 'plateAdd':
        if (isPlayer) this.audio.plateAdd();
        this.vfx.sparkle(top.setY(top.y + 0.2), '#ffffff');
        break;
      case 'trash':
        if (isPlayer) this.audio.trash();
        this.vfx.poof(top);
        break;
      case 'dump':
        if (isPlayer) this.audio.trash();
        this.vfx.poof(top);
        break;
      case 'deny':
        if (isPlayer) this.audio.deny();
        chef.bump(0.15);
        break;
      case 'serveAttempt': {
        const book = isPlayer ? this.playerOrders : this.botOrders;
        const served = book.serve(ev.plate);
        if (served) {
          chef.setHeld(null);
          this.vfx.coins(top.setY(1.2));
          if (isPlayer) {
            this.audio.serve();
            this.floatAt(top, `+${served.coins}`, 'coin');
            if (served.bonus > 0) this.floatAt(top.setY(top.y + 0.6), `Streak x${book.stats.streak}!`, 'info');
          }
        } else {
          if (isPlayer) {
            this.audio.wrong();
            this.floatAt(top, 'Nobody ordered that!', 'bad');
          }
          chef.setHeld(before);
          chef.bump(0.35);
        }
        break;
      }
      default:
        break;
    }
  }

  private handleWork(chef: Chef, delta: number): void {
    const station = chef.target;
    chef.working = false;
    if (!chef.intent.work || !station || !station.canChop()) return;
    if (station.def.owner !== chef.id && station.def.owner !== 'shared') return;
    chef.working = true;
    const rate = chef.id === 'player' ? 1 : this.tuning.botChopRate;
    const item = station.item as Ingredient;
    const color = item.type === 'lettuce' ? '#8fd460' : '#ff6a5a';
    const done = station.chop(delta * rate, this.time);
    const top = this.kitchen!.worldTop(station, this.tmpV);
    if (chef.id === 'player') {
      this.chopSoundTimer -= delta;
      if (this.chopSoundTimer <= 0) {
        this.chopSoundTimer = 0.17;
        this.audio.chop();
        this.vfx.chopBits(top, color);
      }
    } else if (Math.floor(this.time * 6) !== Math.floor((this.time - delta) * 6)) {
      this.vfx.chopBits(top, color);
    }
    if (done) {
      chef.working = false;
      this.vfx.sparkle(top.setY(top.y + 0.15));
      if (chef.id === 'player') this.audio.chopDone();
    }
  }

  private onStationTick(station: Station, ev: 'cookDone' | 'burnWarning' | 'burnt'): void {
    const mine = station.def.owner === 'player';
    const top = this.kitchen!.worldTop(station, this.tmpV);
    if (ev === 'cookDone') {
      this.vfx.sparkle(top.setY(top.y + 0.3), '#c9ffb0');
      if (mine) this.audio.ding();
    } else if (ev === 'burnWarning') {
      if (mine) this.audio.alarm();
    } else if (ev === 'burnt') {
      this.vfx.poof(top);
      if (mine) {
        this.audio.burnt();
        this.floatAt(top, 'Burnt!', 'bad');
      }
    }
  }

  private onOrderEvent(e: OrderEvent, isPlayer: boolean): void {
    if (!isPlayer) return;
    if (e.type === 'new') this.audio.newOrder();
    else {
      this.audio.expired();
      this.hud.showBanner(`${e.order.recipe.name} expired  −5`);
    }
  }

  private emitAmbient(delta: number): void {
    this.emitTimer -= delta;
    if (this.emitTimer > 0) return;
    this.emitTimer = 0.09;
    let sizzle = 0;
    for (const station of this.kitchen!.stations) {
      if (station.kind !== 'pan' && station.kind !== 'pot') continue;
      const state = station.heatState();
      if (state === 'idle' || state === 'filling') continue;
      const top = this.kitchen!.worldTop(station, this.tmpV);
      top.y += station.kind === 'pot' ? 0.05 : 0.1;
      if (state === 'burnt' || state === 'warning') this.vfx.smoke(top);
      else if (this.rng() < 0.7) this.vfx.steam(top);
      if (station.def.owner === 'player' && station.kind === 'pan') sizzle += 1;
    }
    this.audio.setSizzle(Math.min(1, sizzle));
  }

  private endMatch(): void {
    this.phase = 'results';
    this.matchTime = MATCH_LENGTH;
    this.player!.working = false;
    this.bot!.working = false;
    this.audio.setMusic(false);
    this.audio.setSizzle(0);
    this.lastOutcome = this.hud.showResults(this.playerOrders.stats, this.botOrders.stats, this.portraits.player, this.portraits.bot);
    this.setScreen('results');
    if (this.lastOutcome === 'win') {
      this.audio.victory();
      this.vfx.confetti(this.player!.position.clone().setY(1.5));
    } else this.audio.defeat();
    window.setTimeout(() => getEl('#rematch-button').focus(), 50);
  }

  // ---------- Camera + render ----------

  /** Fit the whole kitchen below the HUD for the current aspect ratio. */
  private fitCamera(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const hudEl = document.querySelector<HTMLElement>('#hud');
    const hudBottom = this.phase === 'title' || !hudEl || hudEl.classList.contains('hidden') ? 0 : hudEl.getBoundingClientRect().bottom;
    const key = `${w}x${h}:${Math.round(hudBottom)}`;
    if (key === this.cameraKey) return;
    this.cameraKey = key;

    const portrait = w / h < 1;
    this.camera.fov = portrait ? 44 : 34;
    this.camera.updateProjectionMatrix();
    const bottomLimit = -0.94;
    const topLimit = THREE.MathUtils.clamp(1 - (2 * (hudBottom + 6)) / h, 0.2, 0.95);
    const hx = GRID_W / 2;
    const hz = GRID_H / 2;
    const points = [
      new THREE.Vector3(-hx, 0, hz + 0.8),
      new THREE.Vector3(hx, 0, hz + 0.8),
      new THREE.Vector3(-hx, 1.0, hz + 0.1),
      new THREE.Vector3(hx, 1.0, hz + 0.1),
      new THREE.Vector3(-hx, 1.2, -hz),
      new THREE.Vector3(hx, 1.2, -hz),
    ];
    const dir = new THREE.Vector3(0, Math.sin(CAMERA_PITCH), Math.cos(CAMERA_PITCH));
    const target = new THREE.Vector3(0, 0, 0.3);
    const halfTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const want = (topLimit + bottomLimit) / 2;
    const place = (d: number, shiftZ: number) => {
      this.camera.position.copy(target).setZ(target.z + shiftZ).addScaledVector(dir, d);
      this.camera.lookAt(target.x, target.y, target.z + shiftZ);
      this.camera.updateMatrixWorld(true);
      let minY = Infinity;
      let maxY = -Infinity;
      let maxX = 0;
      for (const p of points) {
        const v = this.tmpV.copy(p).project(this.camera);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        maxX = Math.max(maxX, Math.abs(v.x));
      }
      return { minY, maxY, maxX };
    };
    // For a distance, slide the look target so the kitchen band is centred between the HUD and the bottom edge.
    const centred = (d: number) => {
      let shiftZ = 0;
      for (let i = 0; i < 8; i += 1) {
        const r = place(d, shiftZ);
        shiftZ -= (((r.maxY + r.minY) / 2 - want) * d * halfTan) / Math.sin(CAMERA_PITCH);
      }
      const r = place(d, shiftZ);
      return { shiftZ, ok: r.maxX <= 0.97 && r.minY >= bottomLimit && r.maxY <= topLimit };
    };
    let lo = 4;
    let hi = 120;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      if (centred(mid).ok) hi = mid;
      else lo = mid;
    }
    place(hi, centred(hi).shiftZ);
    this.camera.far = hi + 80;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = hi + 6;
      this.scene.fog.far = hi + 30;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateNameTags(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const { chef, el } of this.nameTags) {
      const v = this.tmpV.copy(chef.position).setY(1.55).project(this.camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  private floatAt(world: THREE.Vector3, text: string, kind: 'coin' | 'bad' | 'info'): void {
    const v = this.tmpV.copy(world).setY(world.y + 0.8).project(this.camera);
    this.hud.floatText(((v.x + 1) / 2) * this.canvas.clientWidth, ((1 - v.y) / 2) * this.canvas.clientHeight, text, kind);
  }

  // ---------- Test hooks + diagnostics ----------

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seedValue = value;
        this.rng = createSeededRandom(value);
      },
      setState: async (name: string) => {
        const states = ['title', 'active-play', 'busy-kitchen', 'results'];
        if (!states.includes(name)) throw new Error(`Unknown test state: ${name}`);
        await this.load();
        this.pausedForScreenshot = false;
        this.resetMatch();
        if (name === 'title') {
          this.phase = 'title';
          this.setScreen('title');
        } else {
          this.phase = 'playing';
          this.setScreen('playing');
          this.simulateOrders(name === 'active-play' ? 6 : 48);
          if (name !== 'active-play') this.stageBusyKitchen();
          if (name === 'results') {
            this.matchTime = MATCH_LENGTH;
            Object.assign(this.playerOrders.stats, { coins: 142, dishes: 6, tips: 38, expired: 1, streak: 0, bestStreak: 4 });
            Object.assign(this.botOrders.stats, { coins: 118, dishes: 5, tips: 27, expired: 2, streak: 0, bestStreak: 3 });
            this.endMatch();
          }
        }
        this.kitchen!.sync(this.time);
        this.fitCamera();
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.vfx.reducedMotion = enabled;
        if (enabled) {
          this.player?.stabilizeVisuals();
          this.bot?.stabilizeVisuals();
        }
        this.render();
      },
      hideDebugUi: (hidden: boolean) => this.debugTools.setHidden(hidden),
    };
  }

  private simulateOrders(seconds: number): void {
    const events: OrderEvent[] = [];
    for (let t = 0; t < seconds; t += 0.5) {
      this.matchTime += 0.5;
      this.playerOrders.update(this.matchTime, 0.5, events);
      this.botOrders.update(this.matchTime, 0.5, events);
    }
    this.hud.update(this.playerOrders.orders, this.botOrders.orders, this.playerOrders.stats, this.botOrders.stats, MATCH_LENGTH - this.matchTime, MATCH_LENGTH, 0);
  }

  /** Deterministic mid-service snapshot used for screenshots. */
  private stageBusyKitchen(): void {
    const k = this.kitchen!;
    const find = (x: number, z: number) => k.stationAt(x, z)!;
    const mirror = (x: number) => GRID_W - 1 - x;
    for (const side of [0, 1] as const) {
      const X = (x: number) => (side ? mirror(x) : x);
      const pan = find(X(2), 0);
      pan.item = { ...ingredient('patty'), state: 'raw' };
      pan.heat = 3.5;
      const pot = find(X(4), 0);
      pot.potType = 'tomato';
      pot.potCount = 3;
      pot.heat = side ? 9 : 4;
      const board = find(X(2), 10);
      board.item = { ...ingredient('lettuce'), chop: 0.55 };
      find(X(4), 10).item = { ...ingredient('tomato'), state: 'chopped' };
      const plate = emptyPlate();
      plate.parts.push('bun', 'patty');
      find(X(0), 3).item = plate;
    }
    const player = this.player!;
    tileToWorld(3, 8, player.position);
    player.facing.set(0, 1);
    player.setHeld({ kind: 'plate', parts: ['lettuce', 'tomato'] });
    const bot = this.bot!;
    tileToWorld(mirror(4), 2, bot.position);
    bot.facing.set(0, -1);
    bot.setHeld(ingredient('noodles'));
    this.playerOrders.stats.coins = 64;
    this.botOrders.stats.coins = 52;
    for (let i = 0; i < 20; i += 1) this.vfx.steam(k.worldTop(find(4, 0), this.tmpV));
    player.update(0.016, k, this.chefTuning(true), bot);
    bot.update(0.016, k, this.chefTuning(false), player);
    this.player!.clearIntent();
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const p = this.player?.position;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.matchTime,
      score: this.playerOrders.stats.coins,
      targetScore: this.botOrders.stats.coins,
      complete: this.phase === 'results',
      phase: this.phase,
      outcome: this.lastOutcome,
      held: this.player?.held ? JSON.stringify(this.player.held) : null,
      target: this.player?.target ? `${this.player.target.kind}@${this.player.target.def.x},${this.player.target.def.z}` : null,
      bot: {
        task: this.brain?.label ?? null,
        held: this.bot?.held ? JSON.stringify(this.bot.held) : null,
        coins: this.botOrders.stats.coins,
        dishes: this.botOrders.stats.dishes,
      },
      stats: { ...this.playerOrders.stats },
      orders: this.playerOrders.orders.map((o) => o.recipe.id),
      player: {
        position: { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 },
        speed: this.player?.velocity.length() ?? 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      assets: { meshes: this.lib.meshCount, triangles: Math.round(this.lib.triangleCount) },
      camera: { x: +this.camera.position.x.toFixed(2), y: +this.camera.position.y.toFixed(2), z: +this.camera.position.z.toFixed(2), fov: this.camera.fov },
      fps: this.fps,
      gpu: this.gpuName,
      batching: this.batchInfo,
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }
}

function getEl(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}
