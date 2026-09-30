import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import {
  createChalkboardTexture,
  createFloorTexture,
  createPlankTexture,
  createWallTexture,
} from '../assets/Textures';
import { GRID_H, GRID_W } from './Layout';

export const WALL_HEIGHT = 3.1;
export const BACK_Z = -GRID_H / 2;
export const SIDE_X = GRID_W / 2;

export function buildEnvironment(lib: AssetLibrary): THREE.Group {
  const env = new THREE.Group();

  const planks = createPlankTexture();
  planks.repeat.set(14, 10);
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 44),
    new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  env.add(outer);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_W, GRID_H),
    new THREE.MeshStandardMaterial({ map: createFloorTexture(), roughness: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  env.add(floor);

  // Back wall + short side walls
  const backTex = createWallTexture(GRID_W + 1, WALL_HEIGHT);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_W + 1, WALL_HEIGHT, 0.3),
    new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.9 }),
  );
  back.position.set(0, WALL_HEIGHT / 2, BACK_Z - 0.15);
  back.receiveShadow = true;
  env.add(back);

  const sideTex = createWallTexture(GRID_H, WALL_HEIGHT);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, WALL_HEIGHT, GRID_H),
      new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 }),
    );
    wall.position.set(side * (SIDE_X + 0.15), WALL_HEIGHT / 2, 0);
    wall.receiveShadow = true;
    env.add(wall);
  }

  // Wall trim along the top
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_W + 1.4, 0.16, 0.42),
    new THREE.MeshStandardMaterial({ color: '#e59f63', roughness: 0.7 }),
  );
  trim.position.set(0, WALL_HEIGHT, BACK_Z - 0.1);
  env.add(trim);

  const wallZ = BACK_Z + 0.01;
  const place = (name: string, x: number, y: number) => {
    const obj = lib.clone(name);
    obj.position.set(x, y, wallZ);
    env.add(obj);
    return obj;
  };

  const board = place('chalkboard', 0, 1.62);
  const face = board.getObjectByName('chalkboard_face') as THREE.Mesh | undefined;
  if (face) {
    const tex = createChalkboardTexture();
    // The Blender plane's UVs run right-to-left when viewed from the front.
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    face.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  }
  place('wall_shelf', -3.4, 1.72);
  place('wall_shelf', 3.4, 1.72);
  place('pan_rack', -6.4, 1.95);
  place('wall_shelf', 6.4, 1.72);

  return env;
}

export function buildLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.background = new THREE.Color('#f3d6ae');
  scene.fog = new THREE.Fog('#f3d6ae', 26, 48);

  scene.add(new THREE.HemisphereLight('#fff8ee', '#e9c79a', 1.9));

  const key = new THREE.DirectionalLight('#fff0da', 2.3);
  key.position.set(-5, 14, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  scene.add(key);

  const rim = new THREE.DirectionalLight('#ffd9c7', 0.6);
  rim.position.set(8, 6, -6);
  scene.add(rim);
  return key;
}
