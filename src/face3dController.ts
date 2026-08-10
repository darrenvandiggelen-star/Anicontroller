import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DirectorAction } from './types';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const FACE_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

function makeMaterial(color: number, roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function cylinder(length: number, radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, length, 18), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

async function faceTextureFromPhoto(file: Blob): Promise<THREE.CanvasTexture> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not available on this device.');

  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = bitmap.width / bitmap.height;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;

  if (sourceRatio > targetRatio) {
    sw = bitmap.height * targetRatio;
    sx = (bitmap.width - sw) / 2;
  } else {
    sh = bitmap.width / targetRatio;
    sy = (bitmap.height - sh) / 2;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.47, canvas.height * 0.49, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  bitmap.close();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class FaceAvatarController {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private bones = new Map<string, THREE.Group>();
  private resizeObserver: ResizeObserver;
  private faceTexture: THREE.Texture | null = null;
  private faceMaterial: THREE.MeshBasicMaterial | null = null;
  private active = false;
  private poseMode: 'bed' | 'stand' | 'sit' = 'bed';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.classList.add('face3d-canvas');
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.zIndex = '2';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    this.camera.position.set(0, 2.4, 2.7);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.65;
    this.controls.maxDistance = 7;
    this.controls.target.set(0, 0.78, -0.75);

    const hemi = new THREE.HemisphereLight(0xf3f5ff, 0x281c35, 1.7);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2.2, 4.2, 3.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9a86ff, 1.1);
    fill.position.set(-2.5, 2.2, 1.4);
    this.scene.add(fill);

    this.createRoom();
    this.createBody();
    this.scene.add(this.root);
    this.lieOnBed();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
    this.setVisible(false);
  }

  async loadFace(file: Blob): Promise<void> {
    const texture = await faceTextureFromPhoto(file);
    if (this.faceTexture) this.faceTexture.dispose();
    this.faceTexture = texture;
    if (this.faceMaterial) {
      this.faceMaterial.map = texture;
      this.faceMaterial.needsUpdate = true;
    }
    this.lieOnBed();
    this.setVisible(true);
  }

  setVisible(visible: boolean): void {
    this.active = visible;
    this.renderer.domElement.style.display = visible ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.active;
  }

  listBones(): string[] {
    return FACE_BONES.filter((name) => this.bones.has(name));
  }

  setBoneRotation(bone: string, axis: 'x' | 'y' | 'z', degrees: number): boolean {
    const joint = this.resolveBone(bone);
    if (!joint) return false;
    joint.rotation[axis] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(degrees, -180, 180));
    return true;
  }

  getBoneRotation(bone: string): { x: number; y: number; z: number } | null {
    const joint = this.resolveBone(bone);
    if (!joint) return null;
    return {
      x: THREE.MathUtils.radToDeg(joint.rotation.x),
      y: THREE.MathUtils.radToDeg(joint.rotation.y),
      z: THREE.MathUtils.radToDeg(joint.rotation.z),
    };
  }

  lieOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'bed';
    this.root.position.set(0, 0.82, 0.12);
    this.root.rotation.set(-Math.PI / 2, 0, 0);
    this.setBoneRotation('leftUpperArm', 'z', -8);
    this.setBoneRotation('rightUpperArm', 'z', 8);
    this.setBoneRotation('leftLowerArm', 'x', -12);
    this.setBoneRotation('rightLowerArm', 'x', -12);
    this.setCameraPreset('full');
  }

  stand(): void {
    this.clearJointRotations();
    this.poseMode = 'stand';
    this.root.position.set(0, 0.02, -0.25);
    this.root.rotation.set(0, 0, 0);
    this.setCameraPreset('full');
  }

  sitOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'sit';
    this.root.position.set(0, 0.62, -0.55);
    this.root.rotation.set(0, 0, 0);
    this.setBoneRotation('leftUpperLeg', 'x', -88);
    this.setBoneRotation('rightUpperLeg', 'x', -88);
    this.setBoneRotation('leftLowerLeg', 'x', 86);
    this.setBoneRotation('rightLowerLeg', 'x', 86);
    this.setCameraPreset('front');
  }

  rollOnBed(side: 'left' | 'right'): void {
    if (this.poseMode !== 'bed') this.lieOnBed();
    this.root.rotation.z = THREE.MathUtils.degToRad(side === 'left' ? 72 : -72);
  }

  resetPose(): void {
    this.lieOnBed();
  }

  setCameraPreset(preset: 'front' | 'close' | 'full'): void {
    if (this.poseMode === 'bed') {
      if (preset === 'close') {
        this.camera.position.set(0, 1.65, -0.72);
        this.controls.target.set(0, 0.87, -1.52);
      } else if (preset === 'front') {
        this.camera.position.set(0, 2.15, 0.4);
        this.controls.target.set(0, 0.78, -0.78);
      } else {
        this.camera.position.set(0, 2.65, 2.75);
        this.controls.target.set(0, 0.72, -0.72);
      }
    } else if (preset === 'close') {
      this.camera.position.set(0, 1.62, 1.15);
      this.controls.target.set(0, 1.58, 0);
    } else if (preset === 'front') {
      this.camera.position.set(0, 1.38, 2.45);
      this.controls.target.set(0, 1.28, 0);
    } else {
      this.camera.position.set(0, 1.15, 3.75);
      this.controls.target.set(0, 1.0, 0);
    }
    this.controls.update();
  }

  async execute(action: DirectorAction): Promise<boolean> {
    switch (action.type) {
      case 'bone':
        return this.setBoneRotation(action.bone, action.axis, action.degrees);
      case 'camera':
        this.setCameraPreset(action.preset);
        return true;
      case 'resetPose':
        this.resetPose();
        return true;
      case 'gesture':
        await this.performWave(action.name === 'waveLeft' ? 'left' : 'right');
        return true;
      case 'expression':
        return false;
    }
  }

  private resolveBone(name: string): THREE.Group | undefined {
    const direct = this.bones.get(name);
    if (direct) return direct;
    const normalized = name.replace(/[\s_-]/g, '').toLowerCase();
    for (const [key, value] of this.bones) {
      if (key.replace(/[\s_-]/g, '').toLowerCase() === normalized) return value;
    }
    return undefined;
  }

  private clearJointRotations(): void {
    for (const joint of this.bones.values()) joint.rotation.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  private addBone(name: string, parent: THREE.Object3D, position: THREE.Vector3): THREE.Group {
    const joint = new THREE.Group();
    joint.name = name;
    joint.position.copy(position);
    parent.add(joint);
    this.bones.set(name, joint);
    return joint;
  }

  private createBody(): void {
    const skin = makeMaterial(0xe5af91, 0.82);
    const shirt = makeMaterial(0x5c55c9, 0.68);
    const pants = makeMaterial(0x24263a, 0.76);
    const shoe = makeMaterial(0x10121d, 0.58);
    const hair = makeMaterial(0x251d2b, 0.9);

    const hips = this.addBone('hips', this.root, new THREE.Vector3(0, 1.02, 0));
    const pelvis = box(0.38, 0.22, 0.22, pants);
    pelvis.position.y = 0.02;
    hips.add(pelvis);

    const spine = this.addBone('spine', hips, new THREE.Vector3(0, 0.14, 0));
    const chest = this.addBone('chest', spine, new THREE.Vector3(0, 0.23, 0));
    const upperChest = this.addBone('upperChest', chest, new THREE.Vector3(0, 0.2, 0));
    const torso = box(0.46, 0.52, 0.25, shirt);
    torso.position.y = -0.05;
    torso.geometry.translate(0, 0.14, 0);
    chest.add(torso);

    const neck = this.addBone('neck', upperChest, new THREE.Vector3(0, 0.25, 0));
    const neckMesh = cylinder(0.13, 0.07, skin);
    neckMesh.position.y = 0.065;
    neck.add(neckMesh);

    const head = this.addBone('head', neck, new THREE.Vector3(0, 0.12, 0));
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.225, 32, 24), skin);
    headMesh.scale.set(0.93, 1.12, 0.9);
    headMesh.position.y = 0.22;
    headMesh.castShadow = true;
    head.add(headMesh);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.23, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
    hairCap.position.y = 0.27;
    hairCap.scale.set(0.96, 1.12, 0.92);
    head.add(hairCap);

    this.faceMaterial = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, toneMapped: false });
    const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.43), this.faceMaterial);
    facePlane.position.set(0, 0.205, 0.207);
    head.add(facePlane);

    const makeArm = (side: 'left' | 'right') => {
      const sign = side === 'left' ? -1 : 1;
      const shoulderName = `${side}Shoulder`;
      const upperName = `${side}UpperArm`;
      const lowerName = `${side}LowerArm`;
      const handName = `${side}Hand`;
      const shoulder = this.addBone(shoulderName, upperChest, new THREE.Vector3(0.28 * sign, 0.15, 0));
      const upper = this.addBone(upperName, shoulder, new THREE.Vector3(0, 0, 0));
      upper.add(cylinder(0.34, 0.072, shirt));
      const lower = this.addBone(lowerName, upper, new THREE.Vector3(0, -0.34, 0));
      lower.add(cylinder(0.31, 0.061, skin));
      const hand = this.addBone(handName, lower, new THREE.Vector3(0, -0.31, 0));
      const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.072, 18, 14), skin);
      handMesh.scale.set(0.82, 1.15, 0.72);
      handMesh.position.y = -0.055;
      hand.add(handMesh);
    };

    makeArm('left');
    makeArm('right');

    const makeLeg = (side: 'left' | 'right') => {
      const sign = side === 'left' ? -1 : 1;
      const upper = this.addBone(`${side}UpperLeg`, hips, new THREE.Vector3(0.13 * sign, -0.09, 0));
      upper.add(cylinder(0.49, 0.095, pants));
      const lower = this.addBone(`${side}LowerLeg`, upper, new THREE.Vector3(0, -0.49, 0));
      lower.add(cylinder(0.46, 0.075, skin));
      const foot = this.addBone(`${side}Foot`, lower, new THREE.Vector3(0, -0.46, 0));
      const footMesh = box(0.15, 0.09, 0.28, shoe);
      footMesh.position.set(0, -0.04, 0.08);
      foot.add(footMesh);
    };

    makeLeg('left');
    makeLeg('right');
  }

  private createRoom(): void {
    const floorMat = makeMaterial(0x121522, 0.95);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const bedFrameMat = makeMaterial(0x3a2c34, 0.9);
    const mattressMat = makeMaterial(0xf0edf5, 0.95);
    const blanketMat = makeMaterial(0x6556ad, 0.9);
    const pillowMat = makeMaterial(0xffffff, 0.96);

    const frame = box(1.58, 0.28, 2.78, bedFrameMat);
    frame.position.set(0, 0.25, -0.82);
    this.scene.add(frame);

    const mattress = box(1.48, 0.24, 2.62, mattressMat);
    mattress.position.set(0, 0.48, -0.82);
    this.scene.add(mattress);

    const blanket = box(1.42, 0.035, 1.18, blanketMat);
    blanket.position.set(0, 0.63, -0.05);
    this.scene.add(blanket);

    const pillow = box(0.68, 0.15, 0.42, pillowMat);
    pillow.position.set(0, 0.68, -1.82);
    pillow.rotation.x = 0.08;
    this.scene.add(pillow);

    const headboard = box(1.62, 0.95, 0.12, bedFrameMat);
    headboard.position.set(0, 0.69, -2.18);
    this.scene.add(headboard);
  }

  private async performWave(side: 'left' | 'right'): Promise<void> {
    const upper = side === 'left' ? 'leftUpperArm' : 'rightUpperArm';
    const lower = side === 'left' ? 'leftLowerArm' : 'rightLowerArm';
    const hand = side === 'left' ? 'leftHand' : 'rightHand';
    const sign = side === 'left' ? -1 : 1;
    this.setBoneRotation(upper, 'z', 82 * sign);
    this.setBoneRotation(lower, 'x', -80);
    for (let i = 0; i < 5; i += 1) {
      this.setBoneRotation(hand, 'z', i % 2 === 0 ? -38 : 38);
      await sleep(130);
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
    if (!this.active) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
