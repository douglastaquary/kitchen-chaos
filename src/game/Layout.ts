import * as THREE from 'three';

export type StationKind =
  | 'counter'
  | 'crate'
  | 'pan'
  | 'pot'
  | 'board'
  | 'plates'
  | 'serve'
  | 'trash'
  | 'sink';

export type CrateContent = 'bun' | 'patty' | 'lettuce' | 'tomato' | 'noodles';

export type Owner = 'player' | 'bot' | 'shared';

export type TileDef = {
  x: number;
  z: number;
  kind: StationKind;
  crate?: CrateContent;
  owner: Owner;
  /** Unit vector (x,z) from the station towards the floor it is used from. */
  facing: THREE.Vector2;
};

// # counter · M meat · B bun · L lettuce · T tomato · N noodles · F pan stove · P pot stove
// X cutting board · D plate stack · W serving window · R trash · K sink · . floor
const MAP = [
  '#MF#PNP###PNP#FM#',
  '#...............#',
  'D...............D',
  '#...............#',
  'W......L#L......W',
  '#......T#T......#',
  'K...............K',
  '#...............#',
  '#...............#',
  '#...............#',
  '#BX#X#R###R#X#XB#',
];

export const GRID_W = MAP[0].length;
export const GRID_H = MAP.length;
export const MID_X = (GRID_W - 1) / 2;

const CRATE_CHARS: Record<string, CrateContent> = {
  M: 'patty',
  B: 'bun',
  L: 'lettuce',
  T: 'tomato',
  N: 'noodles',
};

const KIND_CHARS: Record<string, StationKind> = {
  '#': 'counter',
  F: 'pan',
  P: 'pot',
  X: 'board',
  D: 'plates',
  W: 'serve',
  R: 'trash',
  K: 'sink',
};

export function tileToWorld(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(x - (GRID_W - 1) / 2, 0, z - (GRID_H - 1) / 2);
}

export function worldToTile(wx: number, wz: number): { x: number; z: number } {
  return {
    x: Math.round(wx + (GRID_W - 1) / 2),
    z: Math.round(wz + (GRID_H - 1) / 2),
  };
}

export function isFloorChar(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) return false;
  return MAP[z][x] === '.';
}

export function ownerOf(x: number): Owner {
  if (x < MID_X) return 'player';
  if (x > MID_X) return 'bot';
  return 'shared';
}

export function floorZone(x: number): 'player' | 'mid' | 'bot' {
  if (x < MID_X - 1.5) return 'player';
  if (x > MID_X + 1.5) return 'bot';
  return 'mid';
}

export function parseLayout(): TileDef[] {
  const tiles: TileDef[] = [];
  for (let z = 0; z < GRID_H; z += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      const ch = MAP[z][x];
      if (ch === '.') continue;
      const crate = CRATE_CHARS[ch];
      const kind: StationKind = crate ? 'crate' : KIND_CHARS[ch];
      if (!kind) throw new Error(`Unknown layout char "${ch}" at ${x},${z}`);
      tiles.push({ x, z, kind, crate, owner: ownerOf(x), facing: findFacing(x, z) });
    }
  }
  return tiles;
}

function findFacing(x: number, z: number): THREE.Vector2 {
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dx, dz] of dirs) {
    if (isFloorChar(x + dx, z + dz)) return new THREE.Vector2(dx, dz);
  }
  // Island centre tiles: face the camera.
  return new THREE.Vector2(0, 1);
}

export const PLAYER_SPAWN = { x: 4, z: 6 };
export const BOT_SPAWN = { x: GRID_W - 1 - 4, z: 6 };
