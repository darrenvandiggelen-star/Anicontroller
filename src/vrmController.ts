import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { DirectorAction } from './types';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export class VrmController {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private currentVrm: VRM | null = null;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.setAnimationLoop(() => this.render());
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.camera.position.set(0, 1.35, 2.8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1.25, 0);
    this.controls.minDistance = 0.7;
    this.controls.maxDistance = 7;
    this.controls.enablePan = false;

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.8, 3.1, 2.4);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x7f8cff, 1.15);
    fill.position.set(-2.2, 1.8, 1.1);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xff6fcf, 0.95);
    rim.position.set(0, 2.2, -2.4);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x1a1028, 1.2));

    const grid = new THREE.GridHelper(10, 20, 0x34395f, 0x20243d);
    grid.position.y = 0;
    this.scene.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  async loadFile(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    try {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error('The selected file does not contain a VRM avatar.');

      if (this.currentVrm) {
        this.scene.remove(this.currentVrm.scene);
      }

      VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((obj) => {
        obj.frustumCulled = false;
      });

      this.currentVrm = vrm;
      this.currentVrm.scene.position.set(0, 0, 0);
      this.scene.add(this.currentVrm.scene);
      this.resetPose();
      this.setCameraPreset('full');

      const metaName = typeof vrm.meta?.name === 'string' ? vrm.meta.name : '';
      return metaName || file.name.replace(/\.vrm$/i, '');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  hasCharacter(): boolean {
    return this.currentVrm !== null;
  }

  listBones(): string[] {
    if (!this.currentVrm) return [];
    return Object.keys(this.currentVrm.humanoid.normalizedHumanBones).sort();
  }

  listExpressions(): string[] {
    if (!this.currentVrm?.expressionManager) return [];
    return this.currentVrm.expressionManager.expressions.map((expression) => expression.expressionName).sort();
  }

  setBoneRotation(bone: string, axis: 'x' | 'y' | 'z', degrees: number): boolean {
    if (!this.currentVrm) return false;
    const node = this.currentVrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
    if (!node) return false;
    node.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    return true;
  }

  getBoneRotation(bone: string): { x: number; y: number; z: number } | null {
    if (!this.currentVrm) return null;
    const node = this.currentVrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
    if (!node) return null;
    return {
      x: THREE.MathUtils.radToDeg(node.rotation.x),
      y: THREE.MathUtils.radToDeg(node.rotation.y),
      z: THREE.MathUtils.radToDeg(node.rotation.z),
    };
  }

  setExpression(name: string, value: number): boolean {
    const manager = this.currentVrm?.expressionManager;
    if (!manager) return false;
    const exists = manager.expressions.some((expression) => expression.expressionName === name);
    if (!exists) return false;
    manager.setValue(name, THREE.MathUtils.clamp(value, 0, 1));
    return true;
  }

  resetExpressions(): void {
    const manager = this.currentVrm?.expressionManager;
    if (!manager) return;
    for (const expression of manager.expressions) {
      manager.setValue(expression.expressionName, 0);
    }
  }

  resetPose(): void {
    if (!this.currentVrm) return;
    this.currentVrm.humanoid.resetNormalizedPose();
    this.resetExpressions();
  }

  setCameraPreset(preset: 'front' | 'close' | 'full'): void {
    if (preset === 'close') {
      this.camera.position.set(0, 1.5, 1.25);
      this.controls.target.set(0, 1.48, 0);
    } else if (preset === 'front') {
      this.camera.position.set(0, 1.38, 2.35);
      this.controls.target.set(0, 1.3, 0);
    } else {
      this.camera.position.set(0, 1.18, 3.7);
      this.controls.target.set(0, 1.05, 0);
    }
    this.controls.update();
  }

  async execute(action: DirectorAction): Promise<boolean> {
    switch (action.type) {
      case 'bone':
        return this.setBoneRotation(action.bone, action.axis, action.degrees);
      case 'expression':
        return this.setExpression(action.name, action.value);
      case 'resetPose':
        this.resetPose();
        return true;
      case 'camera':
        this.setCameraPreset(action.preset);
        return true;
      case 'gesture':
        await this.performWave(action.name === 'waveLeft' ? 'left' : 'right');
        return true;
    }
  }

  private async performWave(side: 'left' | 'right'): Promise<void> {
    if (!this.currentVrm) return;
    const upper = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
    const lower = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
    const hand = side === 'left' ? 'leftHand' : 'rightHand';
    const upperSign = side === 'left' ? -1 : 1;

    this.setBoneRotation(upper, 'z', 70 * upperSign);
    this.setBoneRotation(lower, 'x', -75);

    for (let i = 0; i < 4; i += 1) {
      this.setBoneRotation(hand, 'z', i % 2 === 0 ? -35 : 35);
      await sleep(160);
    }
    this.setBoneRotation(hand, 'z', 0);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    const delta = this.clock.getDelta();
    this.controls.update();
    this.currentVrm?.update(delta);
    this.renderer.render(this.scene, this.camera);
  }
}
