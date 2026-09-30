import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges every static mesh under `root` into one mesh per (material, attribute layout).
 * Objects flagged with `userData.dynamic` (and their descendants) are left untouched.
 */
export function batchStatic(root: THREE.Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; cast: boolean }>();
  const victims: THREE.Mesh[] = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || isDynamic(mesh)) return;
    const geo = mesh.geometry;
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const key = `${mesh.material.uuid}|${attrs}|${geo.index ? 'i' : 'n'}`;
    const local = geo.clone();
    local.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld));
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mesh.material, geometries: [], cast: false };
      buckets.set(key, bucket);
    }
    bucket.cast ||= mesh.castShadow;
    bucket.geometries.push(local);
    victims.push(mesh);
  });

  for (const mesh of victims) mesh.parent?.remove(mesh);
  for (const { material, geometries, cast } of buckets.values()) {
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.name = 'staticBatch';
    root.add(mesh);
  }
  return { before: victims.length, after: buckets.size };
}

function isDynamic(obj: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.userData.dynamic) return true;
    o = o.parent;
  }
  return false;
}
