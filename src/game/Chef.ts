import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { ItemVisuals } from '../assets/ItemVisuals';
import { createChefRingTexture } from '../assets/Textures';
import { itemVisualKey, type Item } from './Items';
import { tileToWorld, worldToTile } from './Layout';
import type { Station } from './Stations';

export type ChefId = 'player' | 'bot';

export type ChefIntent = {
  moveX: number;
  moveZ: number;
  interact: boolean;
  work: boolean;
  dash: boolean;
};

export type ChefTuning = {
  speed: number;
  acceleration: number;
  dashSpeed: number;
};

export type CollisionWorld = {
  isSolid(x: number, z: number): boolean;
  stationAt(x: number, z: number): Station | null;
};

export const CHEF_RADIUS = 0.3;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 0.55;

export class Chef {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly velocity = new THREE.Vector2();
  readonly facing = new THREE.Vector2(0, 1);
  readonly intent: ChefIntent = { moveX: 0, moveZ: 0, interact: false, work: false, dash: false };
  held: Item | null = null;
  target: Station | null = null;
  working = false;
  dashing = false;
  /** Seconds since last successful dash start, used for puff VFX. */
  dashStarted = false;

  private readonly pivot = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly body: THREE.Object3D;
  private readonly handL: THREE.Object3D;
  private readonly handR: THREE.Object3D;
  private readonly handLRest = new THREE.Vector3();
  private readonly handRRest = new THREE.Vector3();
  private readonly holdAnchor = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private heldVisual: THREE.Object3D | null = null;
  private heldKey = '';
  private yaw = 0;
  private walkPhase = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private squash = 0;
  private workPhase = 0;
  private readonly tmpDir = new THREE.Vector2();
  private readonly spawn = new THREE.Vector3();

  constructor(
    readonly id: ChefId,
    readonly name: string,
    lib: AssetLibrary,
    private readonly visuals: ItemVisuals,
    spawnTile: { x: number; z: number },
    ringColor: string,
  ) {
    const asset = id === 'player' ? 'chef_player' : 'chef_bot';
    this.model = lib.clone(asset);
    this.body = this.model.getObjectByName(`${asset}_body`) ?? this.model;
    this.handL = this.model.getObjectByName(`${asset}_handL`) ?? new THREE.Object3D();
    this.handR = this.model.getObjectByName(`${asset}_handR`) ?? new THREE.Object3D();
    this.handLRest.copy(this.handL.position);
    this.handRRest.copy(this.handR.position);

    this.pivot.add(this.model);
    this.group.add(this.pivot);
    this.holdAnchor.position.set(0, 0.5, 0.46);
    this.pivot.add(this.holdAnchor);

    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 1.05),
      new THREE.MeshBasicMaterial({ map: createChefRingTexture(ringColor), transparent: true, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.ring.renderOrder = 1;
    this.group.add(this.ring);

    tileToWorld(spawnTile.x, spawnTile.z, this.spawn);
    this.reset();
  }

  reset(): void {
    this.position.copy(this.spawn);
    this.velocity.set(0, 0);
    this.facing.set(0, 1);
    this.yaw = 0;
    this.held = null;
    this.target = null;
    this.working = false;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.syncHeld();
    this.pivot.rotation.set(0, 0, 0);
  }

  clearIntent(): void {
    this.intent.moveX = 0;
    this.intent.moveZ = 0;
    this.intent.interact = false;
    this.intent.work = false;
    this.intent.dash = false;
  }

  update(delta: number, world: CollisionWorld, tuning: ChefTuning, other: Chef | null): void {
    const input = this.tmpDir.set(this.intent.moveX, this.intent.moveZ);
    if (input.lengthSq() > 1) input.normalize();

    this.dashStarted = false;
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    if (this.intent.dash && this.dashCooldown <= 0) {
      this.dashTimer = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      this.dashStarted = true;
    }
    this.dashing = this.dashTimer > 0;
    if (this.dashTimer > 0) {
      this.dashTimer -= delta;
      this.velocity.set(this.facing.x * tuning.dashSpeed, this.facing.y * tuning.dashSpeed);
    } else {
      const k = 1 - Math.exp(-tuning.acceleration * delta);
      this.velocity.x += (input.x * tuning.speed - this.velocity.x) * k;
      this.velocity.y += (input.y * tuning.speed - this.velocity.y) * k;
    }

    if (input.lengthSq() > 0.04) {
      this.facing.copy(input).normalize();
    }

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.y * delta;
    this.resolveCollisions(world, other);

    this.target = this.findTarget(world);
    this.animate(delta);
  }

  /** Hand the chef a new held item (or null) and rebuild its visual if needed. */
  setHeld(item: Item | null): void {
    this.held = item;
    this.syncHeld();
  }

  syncHeld(): void {
    const key = this.held ? itemVisualKey(this.held) : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    if (this.heldVisual) this.holdAnchor.remove(this.heldVisual);
    this.heldVisual = this.held ? this.visuals.build(this.held) : null;
    if (this.heldVisual) this.holdAnchor.add(this.heldVisual);
    this.squash = 0.25;
  }

  bump(amount = 0.3): void {
    this.squash = amount;
  }

  tile(): { x: number; z: number } {
    return worldToTile(this.position.x, this.position.z);
  }

  private resolveCollisions(world: CollisionWorld, other: Chef | null): void {
    for (let pass = 0; pass < 2; pass += 1) {
      const { x: tx, z: tz } = this.tile();
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = tx + dx;
          const z = tz + dz;
          if (!world.isSolid(x, z)) continue;
          const c = tileToWorld(x, z, tmpVec);
          const nx = THREE.MathUtils.clamp(this.position.x, c.x - 0.5, c.x + 0.5);
          const nz = THREE.MathUtils.clamp(this.position.z, c.z - 0.5, c.z + 0.5);
          const ox = this.position.x - nx;
          const oz = this.position.z - nz;
          const d2 = ox * ox + oz * oz;
          if (d2 >= CHEF_RADIUS * CHEF_RADIUS) continue;
          const d = Math.sqrt(d2) || 0.0001;
          const push = CHEF_RADIUS - d;
          this.position.x += (ox / d) * push;
          this.position.z += (oz / d) * push;
          if (Math.abs(ox) > Math.abs(oz)) this.velocity.x *= 0.2;
          else this.velocity.y *= 0.2;
        }
      }
    }
    if (other) {
      const ox = this.position.x - other.position.x;
      const oz = this.position.z - other.position.z;
      const d2 = ox * ox + oz * oz;
      const min = CHEF_RADIUS * 2;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        this.position.x += (ox / d) * push;
        this.position.z += (oz / d) * push;
      }
    }
  }

  private findTarget(world: CollisionWorld): Station | null {
    const probe = worldToTile(this.position.x + this.facing.x * 0.78, this.position.z + this.facing.y * 0.78);
    const direct = world.stationAt(probe.x, probe.z);
    if (direct) return direct;
    const { x: tx, z: tz } = this.tile();
    let best: Station | null = null;
    let bestScore = 0.35;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const s = world.stationAt(tx + dx, tz + dz);
        if (!s) continue;
        const c = tileToWorld(tx + dx, tz + dz, tmpVec);
        const vx = c.x - this.position.x;
        const vz = c.z - this.position.z;
        const len = Math.hypot(vx, vz);
        if (len > 1.25) continue;
        const score = (vx * this.facing.x + vz * this.facing.y) / len - len * 0.1;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }
    return best;
  }

  private animate(delta: number): void {
    const targetYaw = Math.atan2(this.facing.x, this.facing.y);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (1 - Math.exp(-16 * delta));
    this.pivot.rotation.y = this.yaw;

    const speed = this.velocity.length();
    const moving = speed > 0.4;
    this.walkPhase += delta * (moving ? 6 + speed * 1.6 : 0);
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : 0;
    this.squash = Math.max(0, this.squash - delta * 1.8);
    const squashWave = Math.sin(this.squash * 20) * this.squash * 0.35;

    this.pivot.position.y = bob;
    const lean = moving ? Math.min(0.2, speed * 0.035) : 0;
    this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, lean + (this.dashing ? 0.22 : 0), 1 - Math.exp(-10 * delta));
    const breathe = moving ? 0 : Math.sin(performance.now() * 0.003) * 0.015;
    this.body.scale.set(1 + squashWave + breathe, 1 - squashWave - breathe, 1 + squashWave + breathe);
    this.model.rotation.z = moving ? Math.sin(this.walkPhase) * 0.06 : 0;

    const k = 1 - Math.exp(-18 * delta);
    if (this.working) {
      this.workPhase += delta * 16;
      const chopY = Math.abs(Math.sin(this.workPhase)) * 0.2;
      this.handR.position.lerp(tmpVec.set(this.handRRest.x * 0.6, this.handRRest.y + 0.1 + chopY, this.handRRest.z + 0.28), k);
      this.handL.position.lerp(tmpVec.set(this.handLRest.x * 0.7, this.handLRest.y + 0.02, this.handLRest.z + 0.26), k);
    } else if (this.held) {
      this.handL.position.lerp(tmpVec.set(this.handLRest.x * 0.75, this.handLRest.y + 0.06, this.handLRest.z + 0.3), k);
      this.handR.position.lerp(tmpVec.set(this.handRRest.x * 0.75, this.handRRest.y + 0.06, this.handRRest.z + 0.3), k);
    } else {
      const swing = moving ? Math.sin(this.walkPhase) * 0.1 : 0;
      this.handL.position.lerp(tmpVec.set(this.handLRest.x, this.handLRest.y + (moving ? 0.02 : 0), this.handLRest.z + swing), k);
      this.handR.position.lerp(tmpVec.set(this.handRRest.x, this.handRRest.y + (moving ? 0.02 : 0), this.handRRest.z - swing), k);
    }
    if (this.heldVisual) {
      this.heldVisual.position.y = moving ? Math.sin(this.walkPhase * 2) * 0.015 : 0;
    }
    this.ring.rotation.z += delta * 0.6;
  }

  stabilizeVisuals(): void {
    this.walkPhase = 0;
    this.squash = 0;
    this.pivot.position.y = 0;
    this.model.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
  }
}

const tmpVec = new THREE.Vector3();
