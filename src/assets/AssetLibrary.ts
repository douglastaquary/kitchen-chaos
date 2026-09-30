import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type AssetInfo = {
  source: THREE.Object3D;
  height: number;
  bounds: THREE.Box3;
};

/** Loads the Blender-authored kit (public/assets/kitchen.glb) and hands out clones by node name. */
export class AssetLibrary {
  private readonly assets = new Map<string, AssetInfo>();
  meshCount = 0;
  triangleCount = 0;

  async load(url: string, onProgress?: (fraction: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url, (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    for (const child of [...root.children]) {
      child.position.set(0, 0, 0);
      child.updateMatrixWorld(true);
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        this.meshCount += 1;
        const geo = mesh.geometry;
        this.triangleCount += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        tuneMaterial(mesh.material as THREE.Material);
      });
      const bounds = new THREE.Box3().setFromObject(child);
      this.assets.set(child.name, { source: child, height: bounds.max.y, bounds });
    }
  }

  has(name: string): boolean {
    return this.assets.has(name);
  }

  info(name: string): AssetInfo {
    const info = this.assets.get(name);
    if (!info) throw new Error(`Missing asset "${name}" in kitchen.glb`);
    return info;
  }

  height(name: string): number {
    return this.info(name).height;
  }

  clone(name: string): THREE.Object3D {
    const copy = this.info(name).source.clone(true);
    copy.name = name;
    return copy;
  }

  names(): string[] {
    return [...this.assets.keys()];
  }
}

function tuneMaterial(material: THREE.Material): void {
  const std = material as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  // Soft pastel look: keep highlights broad and gentle.
  if (std.metalness < 0.5) std.roughness = Math.max(std.roughness, 0.55);
  std.envMapIntensity = 0.6;
}
