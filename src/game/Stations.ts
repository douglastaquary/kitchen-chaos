import {
  BURN_WARNING,
  CHOP_TIME,
  PAN_BURN_TIME,
  PAN_COOK_TIME,
  POT_BURN_TIME,
  POT_RECIPES,
  canAddPart,
  emptyPlate,
  ingredient,
  isChoppable,
  plateReadyPart,
  type Ingredient,
  type Item,
  type Plate,
} from './Items';
import type { TileDef } from './Layout';

export type PotType = keyof typeof POT_RECIPES;

export type HeatState = 'idle' | 'filling' | 'cooking' | 'done' | 'warning' | 'burnt';

export type StationEvent =
  | { type: 'pickup' | 'place' | 'plateAdd' | 'potAdd' | 'trash' | 'deny' | 'chop' | 'dump' }
  | { type: 'chopDone' }
  | { type: 'serveAttempt'; plate: Plate };

export type InteractResult = {
  held: Item | null;
  events: StationEvent[];
};

export type StationTickEvent = 'cookDone' | 'burnWarning' | 'burnt';

export class Station {
  item: Item | null = null;
  heat = 0;
  potType: PotType | null = null;
  potCount = 0;
  lastChopAt = -10;
  private warned = false;

  constructor(readonly def: TileDef) {}

  get kind() {
    return this.def.kind;
  }

  reset(): void {
    this.item = null;
    this.heat = 0;
    this.potType = null;
    this.potCount = 0;
    this.warned = false;
    this.lastChopAt = -10;
  }

  /** Pan/pot cooking state for visuals, HUD rings and the bot. */
  heatState(): HeatState {
    if (this.kind === 'pan') {
      const patty = this.item as Ingredient | null;
      if (!patty) return 'idle';
      if (patty.state === 'burnt') return 'burnt';
      if (patty.state === 'cooked') return this.heat > PAN_COOK_TIME + PAN_BURN_TIME - BURN_WARNING ? 'warning' : 'done';
      return 'cooking';
    }
    if (this.kind === 'pot') {
      if (!this.potType) return 'idle';
      const recipe = POT_RECIPES[this.potType];
      if (this.potCount < recipe.needs) return 'filling';
      if (this.heat >= recipe.cookTime + POT_BURN_TIME) return 'burnt';
      if (this.heat >= recipe.cookTime + POT_BURN_TIME - BURN_WARNING) return 'warning';
      if (this.heat >= recipe.cookTime) return 'done';
      return 'cooking';
    }
    return 'idle';
  }

  /** 0..1 cook progress (or chop progress for boards). */
  progress(): number {
    if (this.kind === 'board') {
      const it = this.item;
      if (it && it.kind === 'ingredient' && CHOP_TIME[it.type] && it.state === 'raw') return it.chop;
      return 0;
    }
    if (this.kind === 'pan' && this.item) return Math.min(1, this.heat / PAN_COOK_TIME);
    if (this.kind === 'pot' && this.potType) {
      const recipe = POT_RECIPES[this.potType];
      if (this.potCount < recipe.needs) return 0;
      return Math.min(1, this.heat / recipe.cookTime);
    }
    return 0;
  }

  update(delta: number): StationTickEvent | null {
    if (this.kind === 'pan' && this.item && this.item.kind === 'ingredient') {
      const patty = this.item;
      if (patty.state === 'burnt') return null;
      this.heat += delta;
      if (patty.state === 'raw' && this.heat >= PAN_COOK_TIME) {
        patty.state = 'cooked';
        this.warned = false;
        return 'cookDone';
      }
      if (patty.state === 'cooked') {
        if (!this.warned && this.heat >= PAN_COOK_TIME + PAN_BURN_TIME - BURN_WARNING) {
          this.warned = true;
          return 'burnWarning';
        }
        if (this.heat >= PAN_COOK_TIME + PAN_BURN_TIME) {
          patty.state = 'burnt';
          return 'burnt';
        }
      }
      return null;
    }
    if (this.kind === 'pot' && this.potType) {
      const recipe = POT_RECIPES[this.potType];
      if (this.potCount < recipe.needs) return null;
      const before = this.heatState();
      if (before === 'burnt') return null;
      this.heat += delta;
      const after = this.heatState();
      if (before === 'cooking' && after !== 'cooking') return 'cookDone';
      if (before === 'done' && after === 'warning') return 'burnWarning';
      if (after === 'burnt') return 'burnt';
    }
    return null;
  }

  /** Advance chopping; returns true when the ingredient finishes. */
  chop(delta: number, now: number): boolean {
    if (this.kind !== 'board' || !isChoppable(this.item)) return false;
    const it = this.item;
    it.chop = Math.min(1, it.chop + delta / (CHOP_TIME[it.type] ?? 1));
    this.lastChopAt = now;
    if (it.chop >= 1) {
      it.state = 'chopped';
      return true;
    }
    return false;
  }

  canChop(): boolean {
    return this.kind === 'board' && isChoppable(this.item);
  }

  interact(held: Item | null): InteractResult {
    switch (this.kind) {
      case 'crate':
        return this.interactCrate(held);
      case 'plates':
        if (!held) return { held: emptyPlate(), events: [{ type: 'pickup' }] };
        return deny(held);
      case 'trash':
        return this.interactTrash(held);
      case 'serve':
        if (held && held.kind === 'plate' && held.parts.length > 0) {
          return { held, events: [{ type: 'serveAttempt', plate: held }] };
        }
        return deny(held);
      case 'pan':
        return this.interactPan(held);
      case 'pot':
        return this.interactPot(held);
      default:
        return this.interactSurface(held);
    }
  }

  private interactCrate(held: Item | null): InteractResult {
    const type = this.def.crate!;
    if (!held) return { held: ingredient(type), events: [{ type: 'pickup' }] };
    if (held.kind === 'plate' && type === 'bun' && canAddPart(held, 'bun')) {
      held.parts.push('bun');
      return { held, events: [{ type: 'plateAdd' }] };
    }
    return deny(held);
  }

  private interactTrash(held: Item | null): InteractResult {
    if (!held) return deny(held);
    if (held.kind === 'plate') {
      if (held.parts.length === 0) return deny(held);
      held.parts.length = 0;
      return { held, events: [{ type: 'trash' }] };
    }
    return { held: null, events: [{ type: 'trash' }] };
  }

  private interactPan(held: Item | null): InteractResult {
    const patty = this.item as Ingredient | null;
    if (!held) {
      if (!patty) return deny(held);
      if (patty.state === 'raw') return deny(held);
      this.item = null;
      this.heat = 0;
      this.warned = false;
      return { held: patty, events: [{ type: 'pickup' }] };
    }
    if (held.kind === 'ingredient' && held.type === 'patty' && held.state === 'raw' && !patty) {
      this.item = held;
      this.heat = 0;
      this.warned = false;
      return { held: null, events: [{ type: 'place' }] };
    }
    if (held.kind === 'plate' && patty && patty.state === 'cooked' && canAddPart(held, 'patty')) {
      held.parts.push('patty');
      this.item = null;
      this.heat = 0;
      this.warned = false;
      return { held, events: [{ type: 'plateAdd' }] };
    }
    return deny(held);
  }

  private interactPot(held: Item | null): InteractResult {
    const state = this.heatState();
    if (!held) {
      if (state === 'burnt') {
        this.clearPot();
        return { held: null, events: [{ type: 'dump' }] };
      }
      return deny(held);
    }
    if (held.kind === 'ingredient') {
      const type = held.type === 'tomato' ? 'tomato' : held.type === 'noodles' ? 'noodles' : null;
      if (!type) return deny(held);
      const recipe = POT_RECIPES[type];
      if (held.state !== recipe.state) return deny(held);
      if (this.potType && this.potType !== type) return deny(held);
      if (this.potCount >= recipe.needs) return deny(held);
      this.potType = type;
      this.potCount += 1;
      this.heat = 0;
      return { held: null, events: [{ type: 'potAdd' }] };
    }
    if (held.kind === 'plate' && this.potType && (state === 'done' || state === 'warning')) {
      const part = POT_RECIPES[this.potType].part;
      if (held.parts.length > 0) return deny(held);
      held.parts.push(part);
      this.clearPot();
      return { held, events: [{ type: 'plateAdd' }] };
    }
    return deny(held);
  }

  private clearPot(): void {
    this.potType = null;
    this.potCount = 0;
    this.heat = 0;
    this.warned = false;
  }

  private interactSurface(held: Item | null): InteractResult {
    const here = this.item;
    if (!held) {
      if (!here) return deny(held);
      this.item = null;
      return { held: here, events: [{ type: 'pickup' }] };
    }
    if (!here) {
      if (this.kind === 'board' && held.kind === 'plate') return deny(held);
      this.item = held;
      return { held: null, events: [{ type: 'place' }] };
    }
    // Combine ingredient + plate in either direction.
    if (held.kind === 'ingredient' && here.kind === 'plate') {
      const part = plateReadyPart(held);
      if (part && canAddPart(here, part)) {
        here.parts.push(part);
        return { held: null, events: [{ type: 'plateAdd' }] };
      }
    }
    if (held.kind === 'plate' && here.kind === 'ingredient') {
      const part = plateReadyPart(here);
      if (part && canAddPart(held, part)) {
        held.parts.push(part);
        this.item = null;
        return { held, events: [{ type: 'plateAdd' }] };
      }
    }
    return deny(held);
  }
}

function deny(held: Item | null): InteractResult {
  return { held, events: [{ type: 'deny' }] };
}
