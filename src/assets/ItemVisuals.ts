import * as THREE from 'three';
import type { Ingredient, Item, Plate, PlatePart } from '../game/Items';
import type { AssetLibrary } from './AssetLibrary';

const STACK_OVERLAP = 0.8;

export class ItemVisuals {
  constructor(private readonly lib: AssetLibrary) {}

  build(item: Item): THREE.Group {
    const group = new THREE.Group();
    if (item.kind === 'ingredient') group.add(this.lib.clone(ingredientAsset(item)));
    else this.buildPlate(item, group);
    return group;
  }

  /** Visual for a single plate part, used for icons. */
  buildPart(part: PlatePart): THREE.Object3D {
    switch (part) {
      case 'bun':
        return this.lib.clone('bun');
      case 'patty':
        return this.lib.clone('patty_cooked');
      case 'lettuce':
        return this.lib.clone('lettuce_chopped');
      case 'tomato':
        return this.lib.clone('tomato_chopped');
      case 'soup':
        return this.lib.clone('bowl_soup');
      case 'noodles':
        return this.lib.clone('bowl_noodles');
    }
  }

  private buildPlate(plate: Plate, group: THREE.Group): void {
    group.add(this.lib.clone('plate'));
    let y = this.lib.height('plate') * 0.7;
    const has = (p: PlatePart) => plate.parts.includes(p);

    const stackOn = (name: string) => {
      const obj = this.lib.clone(name);
      obj.position.y = y;
      group.add(obj);
      y += this.lib.height(name) * STACK_OVERLAP;
    };

    if (has('soup')) return stackOn('bowl_soup');
    if (has('noodles')) return stackOn('bowl_noodles');

    if (has('bun') || has('patty')) {
      if (has('bun')) stackOn('bun_bottom');
      if (has('patty')) stackOn('patty_cooked');
      if (has('lettuce')) stackOn('lettuce_chopped');
      if (has('tomato')) stackOn('tomato_chopped');
      if (has('bun')) stackOn('bun_top');
      return;
    }
    // Salad-style: toppings side by side on the plate.
    const toppings = plate.parts.filter((p) => p === 'lettuce' || p === 'tomato');
    toppings.forEach((part, index) => {
      const obj = this.buildPart(part);
      obj.scale.setScalar(0.8);
      obj.position.set(toppings.length > 1 ? (index === 0 ? -0.08 : 0.08) : 0, y, index === 0 ? 0.02 : -0.02);
      group.add(obj);
    });
  }
}

export function ingredientAsset(item: Ingredient): string {
  switch (item.type) {
    case 'patty':
      return item.state === 'cooked' ? 'patty_cooked' : item.state === 'burnt' ? 'patty_burnt' : 'patty_raw';
    case 'lettuce':
      return item.state === 'chopped' ? 'lettuce_chopped' : 'lettuce';
    case 'tomato':
      return item.state === 'chopped' ? 'tomato_chopped' : 'tomato';
    default:
      return item.type;
  }
}
