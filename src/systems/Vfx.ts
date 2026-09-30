import * as THREE from 'three';
import { createSoftDotTexture, createStarTexture } from '../assets/Textures';

type Particle = {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  gravity: number;
  drag: number;
  spin: number;
  alpha: number;
};

type Burst = {
  count: number;
  color: THREE.ColorRepresentation | THREE.ColorRepresentation[];
  speed: [number, number];
  up: [number, number];
  life: [number, number];
  size: [number, number];
  gravity?: number;
  drag?: number;
  star?: boolean;
  spread?: number;
  alpha?: number;
  additive?: boolean;
};

const POOL = 260;

/** Pooled billboard particles for cooking and service feedback. */
export class Vfx {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly dot = createSoftDotTexture();
  private readonly star = createStarTexture();
  private cursor = 0;
  private rng = Math.random;
  reducedMotion = false;

  constructor() {
    for (let i = 0; i < POOL; i += 1) {
      const mat = new THREE.SpriteMaterial({ map: this.dot, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 6;
      this.group.add(sprite);
      this.particles.push({
        sprite,
        mat,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size0: 0.1,
        size1: 0.2,
        gravity: 0,
        drag: 0,
        spin: 0,
        alpha: 1,
      });
    }
  }

  setRandom(rng: () => number): void {
    this.rng = rng;
  }

  clear(): void {
    for (const p of this.particles) {
      p.life = 0;
      p.sprite.visible = false;
    }
  }

  emit(pos: THREE.Vector3, burst: Burst): void {
    const r = this.rng;
    const colors = Array.isArray(burst.color) ? burst.color : [burst.color];
    const count = this.reducedMotion ? Math.ceil(burst.count / 3) : burst.count;
    for (let i = 0; i < count; i += 1) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % POOL;
      const angle = r() * Math.PI * 2;
      const speed = lerp(burst.speed[0], burst.speed[1], r());
      const spread = burst.spread ?? 0.1;
      p.sprite.position.set(pos.x + (r() - 0.5) * spread, pos.y, pos.z + (r() - 0.5) * spread);
      p.vel.set(Math.cos(angle) * speed, lerp(burst.up[0], burst.up[1], r()), Math.sin(angle) * speed);
      p.maxLife = p.life = lerp(burst.life[0], burst.life[1], r());
      p.size0 = burst.size[0];
      p.size1 = burst.size[1];
      p.gravity = burst.gravity ?? 0;
      p.drag = burst.drag ?? 1.5;
      p.spin = (r() - 0.5) * 8;
      p.alpha = burst.alpha ?? 1;
      p.mat.map = burst.star ? this.star : this.dot;
      p.mat.color.set(colors[Math.floor(r() * colors.length)]);
      p.mat.blending = burst.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      p.mat.rotation = r() * Math.PI;
      p.mat.needsUpdate = true;
      p.sprite.visible = true;
    }
  }

  steam(pos: THREE.Vector3): void {
    this.emit(pos, { count: 1, color: '#ffffff', speed: [0.02, 0.08], up: [0.5, 0.8], life: [0.9, 1.4], size: [0.1, 0.4], alpha: 0.55, spread: 0.25 });
  }

  smoke(pos: THREE.Vector3): void {
    this.emit(pos, { count: 1, color: ['#4a3f3b', '#6b5d57'], speed: [0.05, 0.12], up: [0.6, 1.0], life: [1.0, 1.6], size: [0.15, 0.6], alpha: 0.7, spread: 0.25 });
  }

  puff(pos: THREE.Vector3): void {
    this.emit(pos, { count: 6, color: '#fffaf0', speed: [0.6, 1.2], up: [0.1, 0.4], life: [0.3, 0.5], size: [0.12, 0.3], alpha: 0.8, drag: 4 });
  }

  chopBits(pos: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.emit(pos, { count: 4, color, speed: [0.6, 1.3], up: [1.2, 2.2], life: [0.35, 0.55], size: [0.07, 0.05], gravity: -7, drag: 0.5 });
  }

  sparkle(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#fff3a0'): void {
    this.emit(pos, { count: 10, color, speed: [0.6, 1.4], up: [0.6, 1.6], life: [0.45, 0.8], size: [0.18, 0.02], star: true, additive: true, drag: 2.5 });
  }

  coins(pos: THREE.Vector3): void {
    this.emit(pos, { count: 18, color: ['#ffd84d', '#ffc233', '#fff0a0'], speed: [1, 2.4], up: [2.5, 4.2], life: [0.7, 1.1], size: [0.2, 0.12], gravity: -8, star: true, drag: 0.8 });
  }

  poof(pos: THREE.Vector3): void {
    this.emit(pos, { count: 12, color: ['#7a6a64', '#9a8a84'], speed: [0.6, 1.4], up: [0.4, 1.2], life: [0.5, 0.9], size: [0.2, 0.5], alpha: 0.8, drag: 3 });
  }

  confetti(pos: THREE.Vector3): void {
    this.emit(pos, { count: 40, color: ['#ff6b6b', '#5cc8b4', '#ffd84d', '#8e7cff', '#ffffff'], speed: [1.5, 4], up: [3, 6], life: [1.2, 2], size: [0.16, 0.12], gravity: -6, star: true, drag: 0.6, spread: 2 });
  }

  update(delta: number): void {
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= delta;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      p.vel.y += p.gravity * delta;
      const damp = Math.exp(-p.drag * delta);
      p.vel.x *= damp;
      p.vel.z *= damp;
      p.sprite.position.addScaledVector(p.vel, delta);
      if (p.sprite.position.y < 0.02) {
        p.sprite.position.y = 0.02;
        p.vel.y *= -0.3;
      }
      const s = lerp(p.size0, p.size1, t);
      p.sprite.scale.set(s, s, 1);
      p.mat.rotation += p.spin * delta;
      p.mat.opacity = p.alpha * Math.min(1, (1 - t) * 3) * Math.min(1, t * 8 + 0.3);
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
