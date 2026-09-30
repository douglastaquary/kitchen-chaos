import { RECIPES, matchesRecipe, type Plate, type Recipe, type RecipeId } from './Items';

export const MATCH_LENGTH = 150;
export const MAX_TICKETS = 5;

export type Order = {
  id: number;
  recipe: Recipe;
  patience: number;
  timeLeft: number;
};

export type ScheduledOrder = { at: number; recipe: RecipeId };

export type Stats = {
  coins: number;
  dishes: number;
  tips: number;
  expired: number;
  streak: number;
  bestStreak: number;
};

export function emptyStats(): Stats {
  return { coins: 0, dishes: 0, tips: 0, expired: 0, streak: 0, bestStreak: 0 };
}

/** Same seeded schedule for both chefs so the match is fair. */
export function buildSchedule(rng: () => number): ScheduledOrder[] {
  const schedule: ScheduledOrder[] = [
    { at: 1, recipe: 'salad' },
    { at: 4, recipe: 'lonelyBurger' },
  ];
  let t = 20;
  const early: RecipeId[] = ['salad', 'lonelyBurger', 'soup'];
  const late: RecipeId[] = ['bigBurger', 'soup', 'noodles', 'salad', 'lonelyBurger', 'bigBurger', 'noodles'];
  while (t < MATCH_LENGTH - 12) {
    const pool = t < 30 ? early : late;
    schedule.push({ at: t, recipe: pool[Math.floor(rng() * pool.length)] });
    const progress = t / MATCH_LENGTH;
    t += 16 - 7 * progress + (rng() - 0.5) * 4;
  }
  return schedule;
}

export type OrderEvent =
  | { type: 'new'; order: Order }
  | { type: 'expired'; order: Order };

export type ServeResult = { order: Order; coins: number; tip: number; bonus: number };

export class OrderBook {
  orders: Order[] = [];
  readonly stats: Stats = emptyStats();
  private cursor = 0;
  private cooldown = 0;
  private nextId = 1;

  constructor(private schedule: ScheduledOrder[]) {}

  reset(schedule: ScheduledOrder[]): void {
    this.schedule = schedule;
    this.orders = [];
    this.cursor = 0;
    this.cooldown = 0;
    this.nextId = 1;
    Object.assign(this.stats, emptyStats());
  }

  update(matchTime: number, delta: number, events: OrderEvent[]): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    for (let i = this.orders.length - 1; i >= 0; i -= 1) {
      const order = this.orders[i];
      order.timeLeft -= delta;
      if (order.timeLeft <= 0) {
        this.orders.splice(i, 1);
        this.stats.expired += 1;
        this.stats.streak = 0;
        this.stats.coins = Math.max(0, this.stats.coins - 5);
        events.push({ type: 'expired', order });
      }
    }
    while (
      this.cursor < this.schedule.length &&
      this.schedule[this.cursor].at <= matchTime &&
      this.orders.length < MAX_TICKETS &&
      this.cooldown <= 0
    ) {
      const recipe = RECIPES[this.schedule[this.cursor].recipe];
      const order: Order = { id: this.nextId++, recipe, patience: recipe.patience, timeLeft: recipe.patience };
      this.orders.push(order);
      this.cursor += 1;
      this.cooldown = 1.2;
      events.push({ type: 'new', order });
    }
    // Never leave a chef with nothing to cook.
    if (this.orders.length === 0 && this.cursor < this.schedule.length && this.cooldown <= 0) {
      this.schedule[this.cursor].at = Math.min(this.schedule[this.cursor].at, matchTime);
    }
  }

  serve(plate: Plate): ServeResult | null {
    const index = this.orders.findIndex((o) => matchesRecipe(plate, o.recipe));
    if (index < 0) return null;
    const [order] = this.orders.splice(index, 1);
    const tip = Math.round((order.timeLeft / order.patience) * 10);
    const bonus = Math.min(10, this.stats.streak * 2);
    const coins = order.recipe.value + tip + bonus;
    this.stats.coins += coins;
    this.stats.tips += tip + bonus;
    this.stats.dishes += 1;
    this.stats.streak += 1;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
    this.cooldown = Math.max(this.cooldown, 2);
    return { order, coins, tip, bonus };
  }
}
