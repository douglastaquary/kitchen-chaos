import * as THREE from 'three';

/**
 * Renders 3D item models into small transparent canvases for HUD tickets and world icon discs.
 * Uses its own tiny renderer so output gets the same sRGB + tone mapping as the main view.
 */
export class IconRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
  private renderer: THREE.WebGLRenderer | null;
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private readonly urls = new Map<string, string>();

  constructor(private readonly size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#e0c49a', 2.2));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(-1.5, 3, 2.5);
    this.scene.add(key);
  }

  render(key: string, object: THREE.Object3D): HTMLCanvasElement {
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (!this.renderer) throw new Error('IconRenderer already disposed');

    this.scene.add(object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.0;
    const dir = new THREE.Vector3(0, 0.85, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(object);

    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    canvas.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    this.cache.set(key, canvas);
    return canvas;
  }

  get(key: string): HTMLCanvasElement | undefined {
    return this.cache.get(key);
  }

  url(key: string): string {
    let url = this.urls.get(key);
    if (!url) {
      const canvas = this.cache.get(key);
      if (!canvas) return '';
      url = canvas.toDataURL('image/png');
      this.urls.set(key, url);
    }
    return url;
  }

  /** Free the GPU context once all icons are baked; cached canvases stay valid. */
  dispose(): void {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
