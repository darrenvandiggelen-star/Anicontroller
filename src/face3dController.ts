import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DirectorAction } from './types';
import type { BodyProfile, FaceProfile } from './avatarAnalysis';

export type TopGarment = 'tshirt' | 'tank' | 'hoodie' | 'jacket' | 'bodysuit';
export type BottomGarment = 'jeans' | 'shorts' | 'skirt' | 'leggings';
export type ShoeGarment = 'sneakers' | 'boots' | 'barefoot';

export interface OutfitProfile {
  top: TopGarment;
  bottom: BottomGarment;
  shoes: ShoeGarment;
  topColor: string;
  bottomColor: string;
  shoeColor: string;
}

export const DEFAULT_OUTFIT: OutfitProfile = {
  top: 'tshirt',
  bottom: 'jeans',
  shoes: 'sneakers',
  topColor: '#6f66ff',
  bottomColor: '#24283a',
  shoeColor: '#f2f2f4',
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const BONE_NAMES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

function mat(color: string | number, roughness = 0.68): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.01 });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, cast = true): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = cast;
  result.receiveShadow = true;
  return result;
}

function limb(length: number, radius: number, material: THREE.Material): THREE.Mesh {
  const part = mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 6, 14), material);
  part.position.y = -length / 2;
  return part;
}

function roundedPart(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  const part = mesh(new THREE.SphereGeometry(0.5, 28, 18), material);
  part.scale.set(width, height, depth);
  return part;
}

export class FaceAvatarController {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private bones = new Map<string, THREE.Group>();
  private resizeObserver: ResizeObserver;
  private active = false;
  private poseMode: 'bed' | 'stand' | 'sit' = 'bed';
  private faceProfile: FaceProfile | null = null;
  private bodyProfile: BodyProfile | null = null;
  private outfit: OutfitProfile = { ...DEFAULT_OUTFIT };
  private mouth: THREE.Mesh | null = null;
  private leftEye: THREE.Mesh | null = null;
  private rightEye: THREE.Mesh | null = null;
  private leftBrow: THREE.Mesh | null = null;
  private rightBrow: THREE.Mesh | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.classList.add('face3d-canvas');
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.zIndex = '3';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
    this.camera.position.set(0, 1.9, 3.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 7;
    this.controls.target.set(0, 1.0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(2.2, 4.2, 3.2);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x94a0ff, 1.05);
    fill.position.set(-2.5, 2.2, 1.4);
    this.scene.add(fill);
    this.scene.add(new THREE.HemisphereLight(0xe8edff, 0x171321, 1.35));

    this.createRoom();
    this.scene.add(this.root);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
    this.setVisible(false);
  }

  configure(face: FaceProfile, body: BodyProfile, outfit: OutfitProfile = DEFAULT_OUTFIT): void {
    this.faceProfile = face;
    this.bodyProfile = body;
    this.outfit = { ...outfit };
    this.rebuildAvatar();
    this.lieOnBed();
    this.setVisible(true);
  }

  setVisible(visible: boolean): void {
    this.active = visible;
    this.renderer.domElement.style.display = visible ? 'block' : 'none';
  }

  isVisible(): boolean { return this.active; }
  listBones(): string[] { return BONE_NAMES.filter((name) => this.bones.has(name)); }
  getOutfit(): OutfitProfile { return { ...this.outfit }; }

  updateBodyProfile(body: BodyProfile): void {
    if (!this.faceProfile) return;
    this.bodyProfile = body;
    this.rebuildAvatar();
    this.lieOnBed();
  }

  setOutfit(next: Partial<OutfitProfile>): void {
    this.outfit = { ...this.outfit, ...next };
    this.rebuildWardrobe();
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

  setExpression(name: string, value: number): boolean {
    if (!this.mouth || !this.leftEye || !this.rightEye) return false;
    const v = THREE.MathUtils.clamp(value, 0, 1);
    this.resetExpressionGeometry();
    const n = name.toLowerCase();
    if (n.includes('happy') || n.includes('smile')) {
      this.mouth.scale.y = 0.45 + v * 0.65;
      this.mouth.rotation.z = THREE.MathUtils.degToRad(-4 * v);
      return true;
    }
    if (n.includes('surpris')) {
      this.mouth.scale.y = 1 + v * 2.3;
      this.mouth.scale.x = 1 - v * 0.25;
      this.leftEye.scale.y = 1 + v * 0.35;
      this.rightEye.scale.y = 1 + v * 0.35;
      return true;
    }
    if (n.includes('blink')) {
      this.leftEye.scale.y = Math.max(0.08, 1 - v * 0.92);
      this.rightEye.scale.y = Math.max(0.08, 1 - v * 0.92);
      return true;
    }
    if (n.includes('angry')) {
      if (this.leftBrow) this.leftBrow.rotation.z = -0.24 * v;
      if (this.rightBrow) this.rightBrow.rotation.z = 0.24 * v;
      return true;
    }
    if (n.includes('sad')) {
      if (this.leftBrow) this.leftBrow.rotation.z = 0.18 * v;
      if (this.rightBrow) this.rightBrow.rotation.z = -0.18 * v;
      this.mouth.rotation.z = THREE.MathUtils.degToRad(4 * v);
      return true;
    }
    return n.includes('neutral') || n.includes('relaxed');
  }

  lieOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'bed';
    this.root.position.set(0, 0.88, 0.15);
    this.root.rotation.set(-Math.PI / 2, 0, 0);
    this.setBoneRotation('leftUpperArm', 'z', -8);
    this.setBoneRotation('rightUpperArm', 'z', 8);
    this.setCameraPreset('full');
  }

  stand(): void {
    this.clearJointRotations();
    this.poseMode = 'stand';
    this.root.position.set(0, 0.03, -0.25);
    this.root.rotation.set(0, 0, 0);
    this.setCameraPreset('full');
  }

  sitOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'sit';
    this.root.position.set(0, 0.7, -0.52);
    this.root.rotation.set(0, 0, 0);
    this.setBoneRotation('leftUpperLeg', 'x', -88);
    this.setBoneRotation('rightUpperLeg', 'x', -88);
    this.setBoneRotation('leftLowerLeg', 'x', 88);
    this.setBoneRotation('rightLowerLeg', 'x', 88);
    this.setCameraPreset('front');
  }

  rollOnBed(side: 'left' | 'right'): void {
    if (this.poseMode !== 'bed') this.lieOnBed();
    this.root.rotation.z = THREE.MathUtils.degToRad(side === 'left' ? 72 : -72);
  }

  resetPose(): void { this.lieOnBed(); }

  setCameraPreset(preset: 'front' | 'close' | 'full'): void {
    if (this.poseMode === 'bed') {
      if (preset === 'close') {
        this.camera.position.set(0, 1.72, -0.68);
        this.controls.target.set(0, 0.93, -1.45);
      } else if (preset === 'front') {
        this.camera.position.set(0, 2.2, 0.42);
        this.controls.target.set(0, 0.78, -0.72);
      } else {
        this.camera.position.set(0, 2.75, 2.9);
        this.controls.target.set(0, 0.72, -0.68);
      }
    } else if (preset === 'close') {
      this.camera.position.set(0, 1.65, 1.08);
      this.controls.target.set(0, 1.58, 0);
    } else if (preset === 'front') {
      this.camera.position.set(0, 1.4, 2.5);
      this.controls.target.set(0, 1.28, 0);
    } else {
      this.camera.position.set(0, 1.15, 3.85);
      this.controls.target.set(0, 1.02, 0);
    }
    this.controls.update();
  }

  async execute(action: DirectorAction): Promise<boolean> {
    switch (action.type) {
      case 'bone': return this.setBoneRotation(action.bone, action.axis, action.degrees);
      case 'expression': return this.setExpression(action.name, action.value);
      case 'resetPose': this.resetPose(); return true;
      case 'camera': this.setCameraPreset(action.preset); return true;
      case 'gesture': await this.performWave(action.name === 'waveLeft' ? 'left' : 'right'); return true;
    }
  }

  private resolveBone(name: string): THREE.Group | undefined {
    return this.bones.get(name) ?? this.bones.get(name.replace(/\s+/g, ''));
  }

  private joint(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    this.bones.set(name, g);
    return g;
  }

  private rebuildAvatar(): void {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.bones.clear();
    this.mouth = this.leftEye = this.rightEye = this.leftBrow = this.rightBrow = null;
    if (!this.faceProfile || !this.bodyProfile) return;

    const f = this.faceProfile;
    const b = this.bodyProfile;
    const scale = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
    const shoulderW = 0.39 * scale * b.shoulderScale * b.buildScale;
    const chestW = 0.32 * scale * b.chestScale * b.buildScale;
    const waistW = 0.25 * scale * b.waistScale * b.buildScale;
    const hipW = 0.29 * scale * b.hipScale * b.buildScale;
    const torsoH = 0.55 * scale;
    const upperArmL = 0.31 * scale * b.armScale;
    const lowerArmL = 0.28 * scale * b.armScale;
    const upperLegL = 0.43 * scale * b.legScale;
    const lowerLegL = 0.42 * scale * b.legScale;
    const skin = mat(f.skinColor, 0.74);
    const baseSuit = mat('#343544', 0.82);

    const hips = this.joint('hips', this.root, 0, upperLegL + lowerLegL + 0.08, 0);
    hips.add(roundedPart(hipW * 0.62, 0.12 * scale, 0.2 * scale, baseSuit));
    const spine = this.joint('spine', hips, 0, 0.16 * scale, 0);
    const waist = roundedPart(waistW * 0.58, 0.18 * scale, 0.16 * scale, baseSuit);
    waist.position.y = 0.09 * scale;
    spine.add(waist);
    const chest = this.joint('chest', spine, 0, 0.22 * scale, 0);
    const torso = roundedPart(chestW * 0.58, torsoH * 0.35, 0.19 * scale, baseSuit);
    torso.position.y = 0.12 * scale;
    chest.add(torso);
    const upperChest = this.joint('upperChest', chest, 0, 0.24 * scale, 0);
    const neck = this.joint('neck', upperChest, 0, 0.16 * scale, 0);
    const neckMesh = limb(0.12 * scale, 0.055 * scale, skin);
    neckMesh.position.y = 0.05 * scale;
    neck.add(neckMesh);
    const head = this.joint('head', neck, 0, 0.13 * scale, 0);
    this.createFace(head, f, scale, skin);

    const armRadius = 0.055 * scale * Math.sqrt(b.buildScale);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const shoulder = this.joint(`${side}Shoulder`, upperChest, sign * shoulderW * 0.48, 0.055 * scale, 0);
      const upper = this.joint(`${side}UpperArm`, shoulder, sign * 0.035 * scale, 0, 0);
      upper.add(limb(upperArmL, armRadius, skin));
      const lower = this.joint(`${side}LowerArm`, upper, 0, -upperArmL, 0);
      lower.add(limb(lowerArmL, armRadius * 0.82, skin));
      const hand = this.joint(`${side}Hand`, lower, 0, -lowerArmL, 0);
      const handMesh = roundedPart(0.06 * scale, 0.095 * scale, 0.035 * scale, skin);
      handMesh.position.y = -0.055 * scale;
      hand.add(handMesh);
    }

    const legRadius = 0.075 * scale * Math.sqrt(b.buildScale);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const upper = this.joint(`${side}UpperLeg`, hips, sign * hipW * 0.34, -0.05 * scale, 0);
      upper.add(limb(upperLegL, legRadius, skin));
      const lower = this.joint(`${side}LowerLeg`, upper, 0, -upperLegL, 0);
      lower.add(limb(lowerLegL, legRadius * 0.83, skin));
      const foot = this.joint(`${side}Foot`, lower, 0, -lowerLegL, 0.03 * scale);
      const footMesh = roundedPart(0.08 * scale, 0.06 * scale, 0.15 * scale, skin);
      footMesh.position.set(0, -0.035 * scale, 0.06 * scale);
      foot.add(footMesh);
    }

    this.rebuildWardrobe();
  }

  private createFace(head: THREE.Group, f: FaceProfile, scale: number, skin: THREE.Material): void {
    const headWidth = 0.19 * scale;
    const headHeight = headWidth * f.faceAspect;
    const headDepth = headWidth * (0.9 + (1 - f.jawWidth) * 0.12);
    const skull = roundedPart(headWidth, headHeight, headDepth, skin);
    skull.position.y = 0.05 * scale;
    head.add(skull);

    const jaw = roundedPart(headWidth * f.jawWidth * 0.72, headHeight * 0.42, headDepth * 0.88, skin);
    jaw.position.set(0, -headHeight * 0.2, 0.012 * scale);
    head.add(jaw);

    const eyeY = headHeight * 0.08;
    const eyeX = headWidth * f.eyeSpacing * 0.95;
    const eyeR = Math.max(0.018 * scale, headWidth * f.eyeWidth * 0.55);
    const eyeMat = mat('#f8f8fb', 0.28);
    const irisMat = mat('#2d3544', 0.35);
    for (const sign of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(eyeR, 20, 14), eyeMat);
      eye.scale.y = 0.68;
      eye.position.set(sign * eyeX, eyeY, headDepth * 0.92);
      head.add(eye);
      const iris = mesh(new THREE.SphereGeometry(eyeR * 0.48, 16, 10), irisMat);
      iris.position.set(sign * eyeX, eyeY, headDepth * 0.98 + eyeR * 0.4);
      head.add(iris);
      if (sign < 0) this.leftEye = eye; else this.rightEye = eye;
    }

    const nose = mesh(new THREE.ConeGeometry(Math.max(0.018 * scale, headWidth * f.noseWidth * 0.25), Math.max(0.045 * scale, headHeight * f.noseLength * 0.38), 20), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -headHeight * 0.04, headDepth * 0.98);
    head.add(nose);

    const mouthWidth = Math.max(0.06 * scale, headWidth * f.mouthWidth * 1.18);
    const mouthHeight = Math.max(0.008 * scale, headHeight * f.mouthHeight * 0.55);
    this.mouth = mesh(new THREE.CapsuleGeometry(mouthHeight, Math.max(0.01, mouthWidth - mouthHeight * 2), 4, 14), mat('#9f5361', 0.42));
    this.mouth.rotation.z = Math.PI / 2;
    this.mouth.scale.y = 0.55;
    this.mouth.position.set(0, -headHeight * 0.22, headDepth * 0.94);
    head.add(this.mouth);

    const browMat = mat(f.hairColor, 0.8);
    for (const sign of [-1, 1]) {
      const brow = mesh(new THREE.BoxGeometry(eyeR * 1.65, 0.009 * scale, 0.012 * scale), browMat);
      brow.position.set(sign * eyeX, eyeY + eyeR * 1.15, headDepth * 0.95);
      head.add(brow);
      if (sign < 0) this.leftBrow = brow; else this.rightBrow = brow;
    }

    const hair = mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), mat(f.hairColor, 0.87));
    hair.scale.set(headWidth * 1.04, headHeight * 1.03, headDepth * 1.04);
    hair.position.y = headHeight * 0.06;
    head.add(hair);
    this.resetExpressionGeometry();
  }

  private resetExpressionGeometry(): void {
    if (this.mouth) this.mouth.scale.set(1, 0.55, 1);
    if (this.leftEye) this.leftEye.scale.set(1, 0.68, 1);
    if (this.rightEye) this.rightEye.scale.set(1, 0.68, 1);
    if (this.leftBrow) this.leftBrow.rotation.z = 0;
    if (this.rightBrow) this.rightBrow.rotation.z = 0;
  }

  private clearWardrobe(): void {
    for (const joint of this.bones.values()) {
      [...joint.children].forEach((child) => {
        if (child.userData.wardrobe) joint.remove(child);
      });
    }
  }

  private addWardrobeMesh(jointName: string, part: THREE.Mesh): void {
    part.userData.wardrobe = true;
    this.bones.get(jointName)?.add(part);
  }

  private rebuildWardrobe(): void {
    if (!this.bodyProfile) return;
    this.clearWardrobe();
    const b = this.bodyProfile;
    const scale = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
    const chestW = 0.32 * scale * b.chestScale * b.buildScale;
    const waistW = 0.25 * scale * b.waistScale * b.buildScale;
    const hipW = 0.29 * scale * b.hipScale * b.buildScale;
    const upperArmL = 0.31 * scale * b.armScale;
    const upperLegL = 0.43 * scale * b.legScale;
    const lowerLegL = 0.42 * scale * b.legScale;
    const topMat = mat(this.outfit.topColor, 0.76);
    const bottomMat = mat(this.outfit.bottomColor, 0.79);
    const shoeMat = mat(this.outfit.shoeColor, 0.62);

    if (this.outfit.top !== 'bodysuit') {
      const bulk = this.outfit.top === 'hoodie' || this.outfit.top === 'jacket' ? 1.13 : 1.05;
      const top = roundedPart(chestW * 0.62 * bulk, 0.21 * scale, 0.205 * scale * bulk, topMat);
      top.position.y = 0.12 * scale;
      this.addWardrobeMesh('chest', top);
      if (this.outfit.top !== 'tank') {
        for (const side of ['left', 'right'] as const) {
          const sleeveLength = this.outfit.top === 'tshirt' ? upperArmL * 0.34 : upperArmL * 0.82;
          const sleeve = limb(sleeveLength, 0.063 * scale * bulk, topMat);
          this.addWardrobeMesh(`${side}UpperArm`, sleeve);
        }
      }
    }

    if (this.outfit.bottom === 'skirt') {
      const skirt = mesh(new THREE.CylinderGeometry(hipW * 0.45, hipW * 0.62, 0.34 * scale, 30), bottomMat);
      skirt.position.y = -0.12 * scale;
      skirt.userData.wardrobe = true;
      this.bones.get('hips')?.add(skirt);
    } else {
      const short = this.outfit.bottom === 'shorts';
      for (const side of ['left', 'right'] as const) {
        const upper = limb(short ? upperLegL * 0.42 : upperLegL * 0.96, 0.082 * scale, bottomMat);
        this.addWardrobeMesh(`${side}UpperLeg`, upper);
        if (!short) {
          const lower = limb(lowerLegL * 0.94, 0.068 * scale, bottomMat);
          this.addWardrobeMesh(`${side}LowerLeg`, lower);
        }
      }
    }

    if (this.outfit.shoes !== 'barefoot') {
      const boot = this.outfit.shoes === 'boots';
      for (const side of ['left', 'right'] as const) {
        const shoe = roundedPart(0.095 * scale, boot ? 0.12 * scale : 0.075 * scale, 0.17 * scale, shoeMat);
        shoe.position.set(0, boot ? 0 : -0.03 * scale, 0.065 * scale);
        this.addWardrobeMesh(`${side}Foot`, shoe);
      }
    }
  }

  private clearJointRotations(): void {
    for (const joint of this.bones.values()) joint.rotation.set(0, 0, 0);
    this.resetExpressionGeometry();
  }

  private async performWave(side: 'left' | 'right'): Promise<void> {
    const upper = `${side}UpperArm`;
    const lower = `${side}LowerArm`;
    const hand = `${side}Hand`;
    this.setBoneRotation(upper, 'z', side === 'left' ? -72 : 72);
    this.setBoneRotation(lower, 'x', -72);
    for (let i = 0; i < 4; i += 1) {
      this.setBoneRotation(hand, 'z', i % 2 ? 30 : -30);
      await sleep(150);
    }
    this.setBoneRotation(hand, 'z', 0);
  }

  private createRoom(): void {
    const floor = mesh(new THREE.PlaneGeometry(8, 8), mat('#141625', 0.94), false);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const bed = new THREE.Group();
    const base = mesh(new THREE.BoxGeometry(2.15, 0.34, 3.55), mat('#3a3047', 0.88));
    base.position.y = 0.32;
    bed.add(base);
    const mattress = mesh(new THREE.BoxGeometry(2.05, 0.25, 3.35), mat('#ddd8df', 0.96));
    mattress.position.y = 0.58;
    bed.add(mattress);
    const pillow = roundedPart(0.58, 0.14, 0.42, mat('#eee9ef', 0.95));
    pillow.position.set(0, 0.78, -1.22);
    bed.add(pillow);
    bed.position.z = -0.72;
    this.scene.add(bed);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
