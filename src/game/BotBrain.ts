import * as THREE from 'three';
import type { Chef } from './Chef';
import {
  POT_RECIPES,
  canAddPart,
  matchesRecipe,
  plateReadyPart,
  type Ingredient,
  type IngredientType,
  type Item,
  type Plate,
  type PlatePart,
  type Recipe,
} from './Items';
import type { Kitchen } from './Kitchen';
import { GRID_H, GRID_W, isFloorChar, tileToWorld } from './Layout';
import type { OrderBook } from './Orders';
import type { Station } from './Stations';

type Action = 'interact' | 'chop' | 'wait';

type Task = {
  station: Station;
  action: Action;
  label: string;
  timeout: number;
};

export type BotTuning = {
  reactionMin: number;
  reactionMax: number;
  chopRate: number;
};

/** Greedy order-driven planner for the rival chef. Emits the same intents a human produces. */
export class BotBrain {
  task: Task | null = null;
  private think = 1.2;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private stuckTime = 0;
  private readonly lastPos = new THREE.Vector3();
  private readonly mine: Station[];
  private readonly assembly: Station;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly chef: Chef,
    kitchen: Kitchen,
    private readonly orders: OrderBook,
    private readonly tuning: BotTuning,
    private rng: () => number,
  ) {
    this.mine = kitchen.stations.filter((s) => s.def.owner === chef.id);
    const serve = this.mine.find((s) => s.kind === 'serve')!;
    this.assembly = this.mine
      .filter((s) => s.kind === 'counter' && s.def.x === serve.def.x)
      .sort((a, b) => Math.abs(a.def.z - serve.def.z) - Math.abs(b.def.z - serve.def.z))[0];
  }

  reset(rng: () => number): void {
    this.rng = rng;
    this.task = null;
    this.think = 1.2;
    this.path = [];
    this.stuckTime = 0;
  }

  get label(): string {
    return this.task?.label ?? 'thinking';
  }

  update(delta: number): void {
    const chef = this.chef;
    chef.clearIntent();

    if (!this.task) {
      this.think -= delta;
      if (this.think > 0) return;
      this.task = this.decide();
      if (!this.task) {
        this.think = 0.4;
        return;
      }
      this.planPath(this.task.station);
    }

    const task = this.task;
    task.timeout -= delta;
    if (task.timeout <= 0) {
      this.finish();
      return;
    }

    if (!this.followPath(delta)) return;

    // Arrived: face the station, then act once it's the chef's target.
    const c = tileToWorld(task.station.def.x, task.station.def.z, this.tmp);
    chef.facing.set(c.x - chef.position.x, c.z - chef.position.z).normalize();
    if (chef.target !== task.station) return;

    if (task.action === 'interact') {
      chef.intent.interact = true;
      this.finish();
    } else if (task.action === 'chop') {
      if (!task.station.canChop()) this.finish();
      else chef.intent.work = true;
    } else if (task.action === 'wait') {
      if (this.waitSatisfied(task.station)) this.finish();
    }
  }

  private finish(): void {
    this.task = null;
    this.think = this.tuning.reactionMin + (this.tuning.reactionMax - this.tuning.reactionMin) * this.rng();
  }

  private waitSatisfied(station: Station): boolean {
    const state = station.heatState();
    return state === 'done' || state === 'warning' || state === 'burnt' || state === 'idle';
  }

  // ---------- Planning ----------

  private decide(): Task | null {
    const held = this.chef.held;
    const recipe = this.targetRecipe();
    if (held) return this.decideHolding(held, recipe);
    return this.decideEmpty(recipe);
  }

  private targetRecipe(): Recipe | null {
    const list = this.orders.orders;
    if (list.length === 0) return null;
    // Prefer the oldest ticket, but switch to one whose pot is already cooking.
    for (const order of list) {
      const potType = potTypeFor(order.recipe);
      if (potType && this.mine.some((s) => s.kind === 'pot' && s.potType === potType)) return order.recipe;
    }
    return list.reduce((a, b) => (a.timeLeft < b.timeLeft ? a : b)).recipe;
  }

  private decideHolding(held: Item, recipe: Recipe | null): Task | null {
    if (held.kind === 'plate') return this.decidePlate(held, recipe);
    return this.decideIngredient(held, recipe);
  }

  private decidePlate(plate: Plate, recipe: Recipe | null): Task | null {
    if (plate.parts.length > 0 && this.orders.orders.some((o) => matchesRecipe(plate, o.recipe))) {
      return this.task_('serve', 'interact', 'serve dish');
    }
    const fitsSomeOrder = this.orders.orders.some((o) => plate.parts.every((p) => o.recipe.parts.includes(p)));
    if (plate.parts.length > 0 && !fitsSomeOrder) return this.task_('trash', 'interact', 'scrap plate');

    const potType = recipe ? potTypeFor(recipe) : null;
    if (potType && plate.parts.length === 0) {
      const pot = this.readyPot(potType);
      if (pot) return this.at(pot, 'interact', 'ladle soup');
    }
    const spot = this.assembly.item ? this.freeCounter() : this.assembly;
    return spot ? this.at(spot, 'interact', 'stage plate') : this.task_('trash', 'interact', 'no room');
  }

  private decideIngredient(item: Ingredient, recipe: Recipe | null): Task | null {
    if (item.state === 'burnt') return this.task_('trash', 'interact', 'bin burnt food');
    const potType = recipe ? potTypeFor(recipe) : null;

    if (item.type === 'tomato' && item.state === 'chopped' && potType === 'tomato') {
      const pot = this.fillablePot('tomato');
      if (pot) return this.at(pot, 'interact', 'tomato into pot');
    }
    if (item.type === 'noodles') {
      const pot = this.fillablePot('noodles');
      if (pot) return this.at(pot, 'interact', 'noodles into pot');
      return this.parkItem();
    }

    const part = plateReadyPart(item);
    if (part) {
      const plateSpot = this.plateStations().find((s) => canAddPart(s.item as Plate, part));
      if (plateSpot) return this.at(plateSpot, 'interact', `add ${part} to plate`);
      return this.parkItem();
    }
    if (item.state === 'raw' && (item.type === 'lettuce' || item.type === 'tomato')) {
      const board = this.mine.find((s) => s.kind === 'board' && !s.item);
      if (board) return this.at(board, 'interact', `put ${item.type} on board`);
      return this.parkItem();
    }
    if (item.type === 'patty' && item.state === 'raw') {
      const pan = this.mine.find((s) => s.kind === 'pan' && !s.item);
      if (pan) return this.at(pan, 'interact', 'patty on pan');
      return this.parkItem();
    }
    return this.task_('trash', 'interact', 'discard');
  }

  private decideEmpty(recipe: Recipe | null): Task | null {
    // Housekeeping first: burnt food and half-chopped ingredients.
    const burntPan = this.mine.find((s) => s.kind === 'pan' && s.heatState() === 'burnt');
    if (burntPan) return this.at(burntPan, 'interact', 'grab burnt patty');
    const burntPot = this.mine.find((s) => s.kind === 'pot' && s.heatState() === 'burnt');
    if (burntPot) return this.at(burntPot, 'interact', 'dump burnt pot');
    const choppable = this.mine.find((s) => s.canChop());
    if (choppable) return this.at(choppable, 'chop', 'chop');

    if (!recipe) {
      const pan = this.mine.find((s) => s.kind === 'pan');
      return pan ? this.at(pan, 'wait', 'wait for tickets', 0.8) : null;
    }

    // A finished plate waiting on a counter? Take it to the pass.
    const served = this.plateStations().find((s) => this.orders.orders.some((o) => matchesRecipe(s.item as Plate, o.recipe)));
    if (served) return this.at(served, 'interact', 'pick up finished plate');

    const potType = potTypeFor(recipe);
    if (potType) return this.decidePotRecipe(potType);
    return this.decidePlateRecipe(recipe);
  }

  private decidePotRecipe(type: keyof typeof POT_RECIPES): Task | null {
    const pot = this.readyPot(type);
    if (pot) {
      const emptyPlate = this.plateStations().find((s) => (s.item as Plate).parts.length === 0);
      return emptyPlate ? this.at(emptyPlate, 'interact', 'grab plate for soup') : this.task_('plates', 'interact', 'grab plate');
    }
    const cooking = this.mine.find((s) => s.kind === 'pot' && s.potType === type && s.heatState() === 'cooking');
    if (cooking) {
      if (!this.plateStations().some((s) => (s.item as Plate).parts.length === 0) && !this.assembly.item) {
        return this.task_('plates', 'interact', 'stage plate');
      }
      return this.at(cooking, 'wait', 'watch the pot', 1.5);
    }
    const fill = this.fillablePot(type);
    if (!fill) return null;
    if (type === 'tomato') {
      const chopped = this.looseIngredient('tomato', 'chopped');
      if (chopped) return this.at(chopped, 'interact', 'grab chopped tomato');
      return this.crate('tomato', 'grab tomato');
    }
    const noodles = this.looseIngredient('noodles', 'raw');
    if (noodles) return this.at(noodles, 'interact', 'grab noodles');
    return this.crate('noodles', 'grab noodles');
  }

  private decidePlateRecipe(recipe: Recipe): Task | null {
    const plateSpot = this.plateStations().find((s) => {
      const p = s.item as Plate;
      return p.parts.every((part) => recipe.parts.includes(part));
    });
    if (!plateSpot) return this.task_('plates', 'interact', 'grab plate');
    const plate = plateSpot.item as Plate;
    const missing = recipe.parts.filter((p) => !plate.parts.includes(p));
    if (missing.length === 0) return this.at(plateSpot, 'interact', 'pick up plate');

    let waitOn: Station | null = null;
    const ordered: PlatePart[] = ['patty', 'lettuce', 'tomato', 'bun'];
    for (const part of ordered) {
      if (!missing.includes(part)) continue;
      if (part === 'patty') {
        const cooked = this.mine.find((s) => s.kind === 'pan' && s.heatState() !== 'burnt' && (s.item as Ingredient | null)?.state === 'cooked');
        if (cooked) return this.at(cooked, 'interact', 'take cooked patty');
        const loose = this.looseIngredient('patty', 'cooked');
        if (loose) return this.at(loose, 'interact', 'grab cooked patty');
        const cooking = this.mine.find((s) => s.kind === 'pan' && s.heatState() === 'cooking');
        if (cooking) {
          waitOn = cooking;
          continue;
        }
        return this.crate('patty', 'grab patty');
      }
      if (part === 'bun') return this.crate('bun', 'grab bun');
      const type = part as IngredientType;
      const chopped = this.looseIngredient(type, 'chopped');
      if (chopped) return this.at(chopped, 'interact', `grab chopped ${type}`);
      return this.crate(type, `grab ${type}`);
    }
    return waitOn ? this.at(waitOn, 'wait', 'watch the pan', 1.5) : null;
  }

  // ---------- Queries ----------

  private plateStations(): Station[] {
    const list = this.mine.filter((s) => (s.kind === 'counter' || s.kind === 'sink') && s.item?.kind === 'plate');
    return list.sort((a, b) => (a === this.assembly ? -1 : b === this.assembly ? 1 : 0));
  }

  private looseIngredient(type: IngredientType, state: Ingredient['state']): Station | null {
    return (
      this.mine.find(
        (s) =>
          (s.kind === 'counter' || s.kind === 'board' || s.kind === 'sink') &&
          s.item?.kind === 'ingredient' &&
          s.item.type === type &&
          s.item.state === state,
      ) ?? null
    );
  }

  private readyPot(type: keyof typeof POT_RECIPES): Station | null {
    return this.mine.find((s) => s.kind === 'pot' && s.potType === type && (s.heatState() === 'done' || s.heatState() === 'warning')) ?? null;
  }

  private fillablePot(type: keyof typeof POT_RECIPES): Station | null {
    const needs = POT_RECIPES[type].needs;
    return (
      this.mine.find((s) => s.kind === 'pot' && s.potType === type && s.potCount < needs) ??
      this.mine.find((s) => s.kind === 'pot' && !s.potType) ??
      null
    );
  }

  private freeCounter(): Station | null {
    const counters = this.mine.filter((s) => s.kind === 'counter' && !s.item);
    const me = this.chef.tile();
    counters.sort((a, b) => dist(a, me) - dist(b, me));
    return counters[0] ?? null;
  }

  private parkItem(): Task | null {
    const spot = this.freeCounter();
    return spot ? this.at(spot, 'interact', 'park item') : this.task_('trash', 'interact', 'no room');
  }

  private crate(type: IngredientType, label: string): Task | null {
    const me = this.chef.tile();
    const crates = this.mine.filter((s) => s.kind === 'crate' && s.def.crate === type).sort((a, b) => dist(a, me) - dist(b, me));
    return crates[0] ? this.at(crates[0], 'interact', label) : null;
  }

  private task_(kind: Station['kind'], action: Action, label: string): Task | null {
    const me = this.chef.tile();
    const list = this.mine.filter((s) => s.kind === kind).sort((a, b) => dist(a, me) - dist(b, me));
    return list[0] ? this.at(list[0], action, label) : null;
  }

  private at(station: Station, action: Action, label: string, timeout = 9): Task {
    return { station, action, label, timeout: action === 'chop' ? 12 : timeout };
  }

  // ---------- Navigation ----------

  private planPath(station: Station): void {
    const start = this.chef.tile();
    const goals = new Set<number>();
    const { x, z } = station.def;
    for (const [dx, dz] of NEIGHBORS) {
      if (isFloorChar(x + dx, z + dz)) goals.add((z + dz) * GRID_W + (x + dx));
    }
    const prev = new Int32Array(GRID_W * GRID_H).fill(-1);
    const startIdx = start.z * GRID_W + start.x;
    prev[startIdx] = startIdx;
    const queue = [startIdx];
    let found = -1;
    while (queue.length) {
      const cur = queue.shift()!;
      if (goals.has(cur)) {
        found = cur;
        break;
      }
      const cx = cur % GRID_W;
      const cz = Math.floor(cur / GRID_W);
      for (const [dx, dz] of NEIGHBORS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!isFloorChar(nx, nz)) continue;
        const ni = nz * GRID_W + nx;
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    this.path = [];
    this.pathIndex = 0;
    if (found < 0) return;
    let cur = found;
    while (cur !== startIdx) {
      this.path.push({ x: cur % GRID_W, z: Math.floor(cur / GRID_W) });
      cur = prev[cur];
    }
    this.path.reverse();
    this.stuckTime = 0;
    this.lastPos.copy(this.chef.position);
  }

  /** Steer along the path; returns true once standing at the approach tile. */
  private followPath(delta: number): boolean {
    const chef = this.chef;
    if (this.pathIndex >= this.path.length) {
      // Settle to the approach tile centre so the facing probe lands on the station.
      const goal = this.path[this.path.length - 1];
      if (goal) {
        const g = tileToWorld(goal.x, goal.z, this.tmp);
        const dx = g.x - chef.position.x;
        const dz = g.z - chef.position.z;
        if (Math.hypot(dx, dz) > 0.22) {
          chef.intent.moveX = dx * 2;
          chef.intent.moveZ = dz * 2;
          return false;
        }
      }
      return true;
    }
    const wp = this.path[this.pathIndex];
    const w = tileToWorld(wp.x, wp.z, this.tmp);
    const dx = w.x - chef.position.x;
    const dz = w.z - chef.position.z;
    const d = Math.hypot(dx, dz);
    const last = this.pathIndex === this.path.length - 1;
    if (d < (last ? 0.2 : 0.35)) {
      this.pathIndex += 1;
      return this.pathIndex >= this.path.length;
    }
    chef.intent.moveX = dx / d;
    chef.intent.moveZ = dz / d;

    if (chef.position.distanceToSquared(this.lastPos) < 0.0004) {
      this.stuckTime += delta;
      if (this.stuckTime > 0.6 && this.task) {
        this.stuckTime = 0;
        this.planPath(this.task.station);
      }
    } else {
      this.stuckTime = 0;
    }
    this.lastPos.copy(chef.position);
    return false;
  }
}

const NEIGHBORS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function dist(s: Station, t: { x: number; z: number }): number {
  return Math.abs(s.def.x - t.x) + Math.abs(s.def.z - t.z);
}

function potTypeFor(recipe: Recipe): keyof typeof POT_RECIPES | null {
  if (recipe.parts.includes('soup')) return 'tomato';
  if (recipe.parts.includes('noodles')) return 'noodles';
  return null;
}