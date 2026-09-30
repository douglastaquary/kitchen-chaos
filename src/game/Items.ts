export type IngredientType = 'bun' | 'patty' | 'lettuce' | 'tomato' | 'noodles';
export type IngredientState = 'raw' | 'chopped' | 'cooked' | 'burnt';

/** Parts that can sit on a plate; each appears at most once. */
export type PlatePart = 'bun' | 'patty' | 'lettuce' | 'tomato' | 'soup' | 'noodles';

export type Ingredient = {
  kind: 'ingredient';
  type: IngredientType;
  state: IngredientState;
  chop: number;
};

export type Plate = {
  kind: 'plate';
  parts: PlatePart[];
};

export type Item = Ingredient | Plate;

export type RecipeId = 'bigBurger' | 'soup' | 'noodles' | 'salad' | 'lonelyBurger';

export type Recipe = {
  id: RecipeId;
  name: string;
  parts: PlatePart[];
  value: number;
  patience: number;
};

export const RECIPES: Record<RecipeId, Recipe> = {
  bigBurger: { id: 'bigBurger', name: 'Big Bonk Burger', parts: ['bun', 'patty', 'lettuce', 'tomato'], value: 30, patience: 80 },
  soup: { id: 'soup', name: 'Sad Tomato Soup', parts: ['soup'], value: 20, patience: 70 },
  noodles: { id: 'noodles', name: 'Noodle Rumble', parts: ['noodles'], value: 24, patience: 66 },
  salad: { id: 'salad', name: 'Rabbit Food', parts: ['lettuce', 'tomato'], value: 16, patience: 58 },
  lonelyBurger: { id: 'lonelyBurger', name: 'Lonely Burger', parts: ['bun', 'patty'], value: 18, patience: 62 },
};

export const RECIPE_ORDER: RecipeId[] = ['bigBurger', 'soup', 'noodles', 'salad', 'lonelyBurger'];

export const CHOP_TIME: Partial<Record<IngredientType, number>> = {
  lettuce: 1.8,
  tomato: 1.5,
};

export const PAN_COOK_TIME = 6.5;
export const PAN_BURN_TIME = 9;
export const POT_RECIPES = {
  tomato: { needs: 3, state: 'chopped' as IngredientState, cookTime: 8, part: 'soup' as PlatePart },
  noodles: { needs: 2, state: 'raw' as IngredientState, cookTime: 7, part: 'noodles' as PlatePart },
};
export const POT_BURN_TIME = 11;
export const BURN_WARNING = 4;

export function ingredient(type: IngredientType): Ingredient {
  return { kind: 'ingredient', type, state: 'raw', chop: 0 };
}

export function emptyPlate(): Plate {
  return { kind: 'plate', parts: [] };
}

export function isChoppable(item: Item | null): item is Ingredient {
  return !!item && item.kind === 'ingredient' && item.state === 'raw' && CHOP_TIME[item.type] !== undefined;
}

/** The plate part an ingredient becomes, if it is ready to be plated. */
export function plateReadyPart(item: Ingredient): PlatePart | null {
  if (item.type === 'bun' && item.state === 'raw') return 'bun';
  if (item.type === 'patty' && item.state === 'cooked') return 'patty';
  if (item.type === 'lettuce' && item.state === 'chopped') return 'lettuce';
  if (item.type === 'tomato' && item.state === 'chopped') return 'tomato';
  return null;
}

/** A part may be added only if the resulting set still fits some recipe. */
export function canAddPart(plate: Plate, part: PlatePart): boolean {
  if (plate.parts.includes(part)) return false;
  const next = [...plate.parts, part];
  return RECIPE_ORDER.some((id) => next.every((p) => RECIPES[id].parts.includes(p)));
}

export function matchesRecipe(plate: Plate, recipe: Recipe): boolean {
  return plate.parts.length === recipe.parts.length && recipe.parts.every((p) => plate.parts.includes(p));
}

export function describeItem(item: Item | null): string {
  if (!item) return 'nothing';
  if (item.kind === 'plate') return item.parts.length ? `plate(${item.parts.join('+')})` : 'plate';
  return `${item.state} ${item.type}`;
}

export function itemVisualKey(item: Item): string {
  if (item.kind === 'plate') return `plate:${[...item.parts].sort().join(',')}`;
  return `${item.type}:${item.state}`;
}
