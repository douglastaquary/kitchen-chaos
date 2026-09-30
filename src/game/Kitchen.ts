import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { IconRenderer } from '../assets/IconRenderer';
import type { ItemVisuals } from '../assets/ItemVisuals';
import {
  createBadgeTexture,
  createBarTexture,
  createHighlightTexture,
  createIconDiscTexture,
} from '../assets/Textures';
import { itemVisualKey, type Item } from './Items';
import { GRID_H, GRID_W, parseLayout, tileToWorld, type CrateContent, type Owner } from './Layout';
import { Station } from './Stations';

const COUNTER_TOP = 0.9;
const COUNTER_VARIANTS = ['counter_teal', 'counter_cream', 'counter_coral', 'counter_teal'];

const POT_FILL_COLORS = {
  tomato: new THREE.Color('#e0503a'),
  noodles: new THREE.Color('#f2cf73'),
  burnt: new THREE.Color('#3a2a24'),
  water: new THREE.Color('#9fd8e6'),
};

type Indicator = {
  group: THREE.Group;
  bg: THREE.Sprite;
  fill: THREE.Sprite;
  fillMat: THREE.SpriteMaterial;
  badge: THREE.Sprite;
  badgeMat: THREE.SpriteMaterial;
};

export class StationView {
  readonly root = new THREE.Group();
  readonly anchor = new THREE.Group();
  itemVisual: THREE.Object3D | null = null;
  itemKey = '';
  potFill: THREE.Mesh | null = null;
  indicator: Indicator | null = null;
  topY = COUNTER_TOP;
  userBob = 0;

  constructor(readonly station: Station) {}
}

export class Kitchen {
  readonly group = new THREE.Group();
  readonly stations: Station[] = [];
  readonly views = new Map<Station, StationView>();
  private readonly grid: (Station | null)[] = new Array(GRID_W * GRID_H).fill(null);
  private readonly highlights: THREE.Mesh[] = [];
  private readonly badgeTextures = {
    warn: createBadgeTexture('warn'),
    done: createBadgeTexture('done'),
    burnt: createBadgeTexture('burnt'),
  };
  private readonly barTexture = createBarTexture();
  private readonly highlightTexture = createHighlightTexture();

  constructor(
    private readonly lib: AssetLibrary,
    private readonly visuals: ItemVisuals,
    private readonly icons: IconRenderer,
  ) {
    for (const def of parseLayout()) {
      const station = new Station(def);
      this.stations.push(station);
      this.grid[def.z * GRID_W + def.x] = station;
      const view = this.buildStation(station);
      this.views.set(station, view);
      this.group.add(view.root);
    }
    for (let i = 0; i < 2; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.02, 1.02),
        new THREE.MeshBasicMaterial({
          map: this.highlightTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          color: i === 0 ? '#fff2b0' : '#ffb3a8',
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.userData.dynamic = true;
      this.highlights.push(mesh);
      this.group.add(mesh);
    }
  }

  stationAt(x: number, z: number): Station | null {
    if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) return null;
    return this.grid[z * GRID_W + x];
  }

  isSolid(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) return true;
    return this.grid[z * GRID_W + x] !== null;
  }

  stationsOf(owner: Owner): Station[] {
    return this.stations.filter((s) => s.def.owner === owner || s.def.owner === 'shared');
  }

  reset(): void {
    for (const s of this.stations) s.reset();
    this.sync(0);
  }

  worldTop(station: Station, target = new THREE.Vector3()): THREE.Vector3 {
    const view = this.views.get(station)!;
    tileToWorld(station.def.x, station.def.z, target);
    target.y = view.topY;
    return target;
  }

  setHighlight(index: number, station: Station | null, time: number): void {
    const mesh = this.highlights[index];
    if (!station) {
      mesh.visible = false;
      return;
    }
    const view = this.views.get(station)!;
    tileToWorld(station.def.x, station.def.z, mesh.position);
    mesh.position.y = view.topY + 0.012;
    if (station.kind === 'trash') mesh.position.y = this.lib.height('trash') + 0.01;
    mesh.visible = true;
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;
    (mesh.material as THREE.MeshBasicMaterial).opacity = pulse;
  }

  /** Rebuild item visuals and indicators to match station state. */
  sync(time: number): void {
    for (const station of this.stations) {
      const view = this.views.get(station)!;
      this.syncItem(view, station.item);
      if (station.kind === 'pot') this.syncPot(view, station, time);
      if (view.indicator) this.syncIndicator(view, station, time);
    }
  }

  private syncItem(view: StationView, item: Item | null): void {
    const key = item ? itemVisualKey(item) : '';
    if (key === view.itemKey) return;
    view.itemKey = key;
    if (view.itemVisual) view.anchor.remove(view.itemVisual);
    view.itemVisual = item ? this.visuals.build(item) : null;
    if (view.itemVisual) {
      view.itemVisual.scale.setScalar(0.001);
      view.anchor.add(view.itemVisual);
    }
  }

  /** Pop-in scale animation for placed items. */
  animate(delta: number): void {
    for (const view of this.views.values()) {
      const v = view.itemVisual;
      if (v && v.scale.x < 1) v.scale.setScalar(Math.min(1, v.scale.x + delta * 7));
    }
  }

  private syncPot(view: StationView, station: Station, time: number): void {
    const fill = view.potFill!;
    const state = station.heatState();
    if (!station.potType) {
      fill.visible = false;
      return;
    }
    fill.visible = true;
    const mat = fill.material as THREE.MeshStandardMaterial;
    const needs = station.potType === 'tomato' ? 3 : 2;
    const level = Math.min(1, station.potCount / needs);
    fill.scale.y = 0.25 + level * 0.75;
    const base = state === 'burnt' ? POT_FILL_COLORS.burnt : POT_FILL_COLORS[station.potType];
    mat.color.copy(state === 'filling' ? POT_FILL_COLORS.water.clone().lerp(base, level * 0.7) : base);
    if (state === 'cooking' || state === 'done') fill.position.y = view.userBob + Math.sin(time * 9) * 0.004;
  }

  private syncIndicator(view: StationView, station: Station, time: number): void {
    const ind = view.indicator!;
    const state = station.heatState();
    const progress = station.progress();
    const showBar =
      (station.kind === 'board' && progress > 0 && progress < 1) ||
      ((station.kind === 'pan' || station.kind === 'pot') && state === 'cooking');
    ind.bg.visible = showBar;
    ind.fill.visible = showBar;
    if (showBar) {
      ind.fill.scale.x = Math.max(0.02, progress) * 0.62;
      ind.fillMat.color.set(station.kind === 'board' ? '#ffd35c' : '#5fd08a');
    }
    let badge: THREE.Texture | null = null;
    if (state === 'done') badge = this.badgeTextures.done;
    else if (state === 'warning') badge = Math.floor(time * 5) % 2 === 0 ? this.badgeTextures.warn : null;
    else if (state === 'burnt') badge = this.badgeTextures.burnt;
    ind.badge.visible = !!badge;
    if (badge && ind.badgeMat.map !== badge) {
      ind.badgeMat.map = badge;
      ind.badgeMat.needsUpdate = true;
    }
    if (badge) {
      const s = 0.42 + (state === 'warning' ? Math.sin(time * 14) * 0.04 : 0);
      ind.badge.scale.set(s, s, 1);
    }
  }

  private buildStation(station: Station): StationView {
    const view = new StationView(station);
    const def = station.def;
    tileToWorld(def.x, def.z, view.root.position);
    const yaw = Math.atan2(def.facing.x, def.facing.y);
    const addAsset = (name: string, y = 0, rotate = true) => {
      const obj = this.lib.clone(name);
      obj.position.y = y;
      if (rotate) obj.rotation.y = yaw;
      view.root.add(obj);
      return obj;
    };

    switch (def.kind) {
      case 'counter':
        addAsset(COUNTER_VARIANTS[(def.x * 7 + def.z * 3) % COUNTER_VARIANTS.length]);
        if ((def.x === 3 || def.x === GRID_W - 4) && def.z === 0) {
          const ext = addAsset('extinguisher', COUNTER_TOP);
          ext.position.x = 0.22;
          ext.position.z = -0.18;
        }
        break;
      case 'crate':
        addAsset('crate_station');
        addAsset(def.crate === 'patty' ? 'heap_meat' : `heap_${def.crate}`, crateFloor(this.lib), true);
        this.addCrateIcon(view, def.crate!);
        break;
      case 'pan':
        addAsset('stove');
        addAsset('pan', COUNTER_TOP);
        view.topY = COUNTER_TOP + 0.025;
        break;
      case 'pot': {
        addAsset('stove');
        addAsset('pot', COUNTER_TOP);
        const fill = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.2, 24),
          new THREE.MeshStandardMaterial({ color: '#e0503a', roughness: 0.35 }),
        );
        fill.geometry.translate(0, 0.1, 0);
        fill.position.y = COUNTER_TOP + 0.04;
        view.userBob = fill.position.y;
        fill.visible = false;
        view.root.add(fill);
        view.potFill = fill;
        view.topY = COUNTER_TOP + 0.35;
        break;
      }
      case 'board':
        addAsset('counter_cream');
        addAsset('cutting_board', COUNTER_TOP);
        view.topY = COUNTER_TOP + 0.05;
        break;
      case 'plates':
        addAsset('counter_cream');
        addAsset('plate_stack', COUNTER_TOP);
        view.topY = COUNTER_TOP + 0.2;
        break;
      case 'serve':
        addAsset('serve_window');
        break;
      case 'trash':
        addAsset('trash');
        view.topY = this.lib.height('trash');
        break;
      case 'sink':
        addAsset('sink');
        break;
    }

    view.anchor.userData.dynamic = true;
    if (view.potFill) view.potFill.userData.dynamic = true;
    view.anchor.position.y = view.topY;
    if (def.kind === 'pan') view.anchor.position.y = COUNTER_TOP + 0.03;
    view.root.add(view.anchor);

    if (def.kind === 'board' || def.kind === 'pan' || def.kind === 'pot') {
      view.indicator = this.createIndicator(def.kind === 'pot' ? 1.45 : 1.2);
      view.root.add(view.indicator.group);
    }
    view.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = true;
    });
    return view;
  }

  private addCrateIcon(view: StationView, content: CrateContent): void {
    const key = `crate:${content}`;
    const assetName = content === 'patty' ? 'patty_raw' : content;
    const icon = this.icons.render(key, this.lib.clone(assetName));
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: createIconDiscTexture(icon), transparent: true, depthWrite: false }),
    );
    sprite.scale.set(0.5, 0.5, 1);
    sprite.position.set(0, 1.5, 0);
    sprite.renderOrder = 5;
    view.root.add(sprite);
  }

  private createIndicator(height: number): Indicator {
    const group = new THREE.Group();
    group.userData.dynamic = true;
    group.position.y = height;
    const bgMat = new THREE.SpriteMaterial({ map: this.barTexture, color: '#3b2f2a', depthTest: false, transparent: true });
    const bg = new THREE.Sprite(bgMat);
    bg.scale.set(0.7, 0.15, 1);
    bg.renderOrder = 10;
    const fillMat = new THREE.SpriteMaterial({ map: this.barTexture, color: '#5fd08a', depthTest: false, transparent: true });
    const fill = new THREE.Sprite(fillMat);
    fill.center.set(0, 0.5);
    fill.position.x = -0.31;
    fill.scale.set(0.62, 0.09, 1);
    fill.renderOrder = 11;
    const badgeMat = new THREE.SpriteMaterial({ map: this.badgeTextures.done, depthTest: false, transparent: true });
    const badge = new THREE.Sprite(badgeMat);
    badge.scale.set(0.42, 0.42, 1);
    badge.position.y = 0.12;
    badge.renderOrder = 12;
    group.add(bg, fill, badge);
    bg.visible = fill.visible = badge.visible = false;
    return { group, bg, fill, fillMat, badge, badgeMat };
  }
}

function crateFloor(lib: AssetLibrary): number {
  // The crate's inner floor sits a little below the rim; heaps rest on it.
  return Math.min(0.8, lib.height('crate_station') - 0.12);
}