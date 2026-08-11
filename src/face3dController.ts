import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DirectorAction } from './types';
import type { BodyProfile, FaceProfile } from './avatarAnalysis';

export type TopGarment = 'tshirt' | 'tank' | 'hoodie' | 'jacket' | 'bodysuit';
export type BottomGarment = 'jeans' | 'shorts' | 'skirt' | 'leggings';
export type ShoeGarment = 'sneakers' | 'boots' | 'barefoot';
export type AdultBodyPreset = 'natural' | 'feminine' | 'masculine' | 'athletic' | 'curvy' | 'slim';

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

interface Section {
  y: number;
  rx: number;
  rz: number;
}

function material(color: string | number, roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.01 });
}

function makeMesh(geometry: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const result = new THREE.Mesh(geometry, mat);
  result.castShadow = cast;
  result.receiveShadow = true;
  return result;
}

function ellipsoid(rx: number, ry: number, rz: number, mat: THREE.Material, segments = 30): THREE.Mesh {
  const m = makeMesh(new THREE.SphereGeometry(1, segments, Math.max(16, Math.round(segments * 0.7))), mat);
  m.scale.set(rx, ry, rz);
  return m;
}

function sectionGeometry(sections: Section[], radialSegments = 28, cap = true): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const ring = radialSegments + 1;
  for (const section of sections) {
    for (let i = 0; i <= radialSegments; i += 1) {
      const a = (i / radialSegments) * Math.PI * 2;
      positions.push(Math.cos(a) * section.rx, section.y, Math.sin(a) * section.rz);
    }
  }
  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let i = 0; i < radialSegments; i += 1) {
      const a = s * ring + i;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (cap) {
    const bottom = positions.length / 3;
    positions.push(0, sections[0].y, 0);
    const top = positions.length / 3;
    positions.push(0, sections[sections.length - 1].y, 0);
    for (let i = 0; i < radialSegments; i += 1) {
      indices.push(bottom, i + 1, i);
      const base = (sections.length - 1) * ring;
      indices.push(top, base + i, base + i + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function taperedLimb(length: number, topRadius: number, bottomRadius: number, mat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const body = makeMesh(new THREE.CylinderGeometry(bottomRadius, topRadius, length, 22, 2, false), mat);
  body.position.y = -length / 2;
  group.add(body);
  const top = ellipsoid(topRadius * 1.03, topRadius * 0.92, topRadius * 1.03, mat, 20);
  top.position.y = -topRadius * 0.18;
  group.add(top);
  const bottom = ellipsoid(bottomRadius * 1.04, bottomRadius * 0.9, bottomRadius * 1.04, mat, 20);
  bottom.position.y = -length + bottomRadius * 0.18;
  group.add(bottom);
  return group;
}

function tagOutfit(object: THREE.Object3D): THREE.Object3D {
  object.userData.outfit = true;
  object.traverse((child) => { child.userData.outfit = true; });
  return object;
}

function copyProfile(body: BodyProfile): BodyProfile {
  return { ...body };
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
  private originalBodyProfile: BodyProfile | null = null;
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
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', zIndex: '3' });
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    this.camera.position.set(0, 1.8, 3.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.55;
    this.controls.maxDistance = 8;
    this.controls.target.set(0, 1.05, 0);
    this.controls.enablePan = false;

    const key = new THREE.DirectionalLight(0xffffff, 2.75);
    key.position.set(2.5, 4.4, 3.4);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9ca7ff, 1.1);
    fill.position.set(-2.6, 2.5, 1.6);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xff9fd7, 0.65);
    rim.position.set(0, 2.7, -3.2);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xeef2ff, 0x17131c, 1.3));

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
    this.bodyProfile = copyProfile(body);
    this.originalBodyProfile = copyProfile(body);
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
    this.bodyProfile = copyProfile(body);
    this.originalBodyProfile = copyProfile(body);
    this.rebuildKeepingPose();
  }

  setOutfit(next: Partial<OutfitProfile>): void {
    this.outfit = { ...this.outfit, ...next };
    this.rebuildWardrobe();
  }

  setAdultBodyPreset(preset: AdultBodyPreset): void {
    if (!this.bodyProfile) return;
    const base = this.originalBodyProfile ? copyProfile(this.originalBodyProfile) : copyProfile(this.bodyProfile);
    const presets: Record<AdultBodyPreset, Partial<BodyProfile>> = {
      natural: {},
      feminine: { shoulderScale: 0.94, chestScale: 1.02, waistScale: 0.86, hipScale: 1.08, buildScale: 0.96 },
      masculine: { shoulderScale: 1.1, chestScale: 1.08, waistScale: 1.0, hipScale: 0.95, buildScale: 1.05 },
      athletic: { shoulderScale: 1.08, chestScale: 1.05, waistScale: 0.9, hipScale: 1.0, buildScale: 1.04 },
      curvy: { shoulderScale: 0.98, chestScale: 1.08, waistScale: 0.82, hipScale: 1.16, buildScale: 1.0 },
      slim: { shoulderScale: 0.96, chestScale: 0.92, waistScale: 0.84, hipScale: 0.96, buildScale: 0.87 },
    };
    this.bodyProfile = { ...base, ...presets[preset] };
    this.rebuildKeepingPose();
  }

  adjustBodyPart(part: string, delta: number): boolean {
    if (!this.bodyProfile) return false;
    const b = this.bodyProfile;
    const d = THREE.MathUtils.clamp(delta, -0.3, 0.3);
    const adjust = (value: number, min: number, max: number) => THREE.MathUtils.clamp(value + d, min, max);
    if (part === 'shoulders') b.shoulderScale = adjust(b.shoulderScale, 0.7, 1.4);
    else if (part === 'chest') b.chestScale = adjust(b.chestScale, 0.7, 1.4);
    else if (part === 'waist') b.waistScale = adjust(b.waistScale, 0.65, 1.45);
    else if (part === 'hips') b.hipScale = adjust(b.hipScale, 0.7, 1.45);
    else if (part === 'build') b.buildScale = adjust(b.buildScale, 0.75, 1.35);
    else if (part === 'arms') b.armScale = adjust(b.armScale, 0.82, 1.2);
    else if (part === 'legs') b.legScale = adjust(b.legScale, 0.82, 1.2);
    else return false;
    this.rebuildKeepingPose();
    return true;
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
    const lower = name.toLowerCase();
    if (lower.startsWith('body:')) {
      const preset = lower.slice(5) as AdultBodyPreset;
      if (!['natural', 'feminine', 'masculine', 'athletic', 'curvy', 'slim'].includes(preset)) return false;
      this.setAdultBodyPreset(preset);
      return true;
    }
    if (lower.startsWith('bodyadjust:')) {
      const [, part, rawDelta] = lower.split(':');
      return this.adjustBodyPart(part, Number(rawDelta));
    }
    if (!this.mouth || !this.leftEye || !this.rightEye) return false;
    const v = THREE.MathUtils.clamp(value, 0, 1);
    this.resetExpressionGeometry();
    if (lower.includes('happy') || lower.includes('smile')) {
      this.mouth.scale.set(1 + v * 0.12, 0.65 + v * 0.5, 1);
      this.mouth.position.y += v * 0.005;
      return true;
    }
    if (lower.includes('surpris')) {
      this.mouth.scale.set(0.75, 1 + v * 1.8, 1);
      this.leftEye.scale.y = 1 + v * 0.3;
      this.rightEye.scale.y = 1 + v * 0.3;
      return true;
    }
    if (lower.includes('blink')) {
      this.leftEye.scale.y = Math.max(0.08, 1 - v * 0.92);
      this.rightEye.scale.y = Math.max(0.08, 1 - v * 0.92);
      return true;
    }
    if (lower.includes('angry')) {
      if (this.leftBrow) this.leftBrow.rotation.z = -0.25 * v;
      if (this.rightBrow) this.rightBrow.rotation.z = 0.25 * v;
      return true;
    }
    if (lower.includes('sad')) {
      if (this.leftBrow) this.leftBrow.rotation.z = 0.2 * v;
      if (this.rightBrow) this.rightBrow.rotation.z = -0.2 * v;
      this.mouth.scale.y = 0.7;
      return true;
    }
    return lower.includes('neutral') || lower.includes('relaxed');
  }

  lieOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'bed';
    this.root.position.set(0, 0.88, 0.22);
    this.root.rotation.set(-Math.PI / 2, 0, 0);
    this.setBoneRotation('leftUpperArm', 'z', -9);
    this.setBoneRotation('rightUpperArm', 'z', 9);
    this.setBoneRotation('leftLowerArm', 'x', -8);
    this.setBoneRotation('rightLowerArm', 'x', -8);
    this.setCameraPreset('full');
  }

  stand(): void {
    this.clearJointRotations();
    this.poseMode = 'stand';
    this.root.position.set(0, 0.03, -0.3);
    this.root.rotation.set(0, 0, 0);
    this.setBoneRotation('leftUpperArm', 'z', 5);
    this.setBoneRotation('rightUpperArm', 'z', -5);
    this.setCameraPreset('full');
  }

  sitOnBed(): void {
    this.clearJointRotations();
    this.poseMode = 'sit';
    this.root.position.set(0, 0.7, -0.58);
    this.root.rotation.set(0, 0, 0);
    this.setBoneRotation('leftUpperLeg', 'x', -88);
    this.setBoneRotation('rightUpperLeg', 'x', -88);
    this.setBoneRotation('leftLowerLeg', 'x', 90);
    this.setBoneRotation('rightLowerLeg', 'x', 90);
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
        this.camera.position.set(0, 1.72, -0.74);
        this.controls.target.set(0, 0.92, -1.46);
      } else if (preset === 'front') {
        this.camera.position.set(0, 2.25, 0.45);
        this.controls.target.set(0, 0.78, -0.74);
      } else {
        this.camera.position.set(0, 2.85, 3.05);
        this.controls.target.set(0, 0.72, -0.7);
      }
    } else if (preset === 'close') {
      this.camera.position.set(0, 1.63, 1.15);
      this.controls.target.set(0, 1.57, 0);
    } else if (preset === 'front') {
      this.camera.position.set(0, 1.42, 2.55);
      this.controls.target.set(0, 1.28, 0);
    } else {
      this.camera.position.set(0, 1.18, 3.95);
      this.controls.target.set(0, 1.04, 0);
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

  private rebuildKeepingPose(): void {
    const pose = this.poseMode;
    this.rebuildAvatar();
    if (pose === 'stand') this.stand();
    else if (pose === 'sit') this.sitOnBed();
    else this.lieOnBed();
  }

  private resolveBone(name: string): THREE.Group | undefined {
    return this.bones.get(name) ?? this.bones.get(name.replace(/\s+/g, ''));
  }

  private joint(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    parent.add(group);
    this.bones.set(name, group);
    return group;
  }

  private rebuildAvatar(): void {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.bones.clear();
    this.mouth = this.leftEye = this.rightEye = this.leftBrow = this.rightBrow = null;
    if (!this.faceProfile || !this.bodyProfile) return;

    const f = this.faceProfile;
    const b = this.bodyProfile;
    const s = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
    const build = b.buildScale;
    const shoulderWidth = 0.50 * s * b.shoulderScale * (0.93 + build * 0.07);
    const chestWidth = 0.41 * s * b.chestScale * build;
    const waistWidth = 0.31 * s * b.waistScale * build;
    const hipWidth = 0.39 * s * b.hipScale * build;
    const chestDepth = 0.205 * s * (0.88 + b.chestScale * 0.12) * build;
    const waistDepth = 0.155 * s * (0.9 + build * 0.1);
    const hipDepth = 0.205 * s * (0.9 + b.hipScale * 0.1) * build;
    const upperArmL = 0.335 * s * b.armScale;
    const lowerArmL = 0.305 * s * b.armScale;
    const upperLegL = 0.465 * s * b.legScale;
    const lowerLegL = 0.445 * s * b.legScale;
    const skin = material(f.skinColor, 0.76);

    const hips = this.joint('hips', this.root, 0, upperLegL + lowerLegL + 0.085 * s, 0);
    const pelvis = makeMesh(sectionGeometry([
      { y: -0.09 * s, rx: hipWidth * 0.42, rz: hipDepth * 0.86 },
      { y: 0.02 * s, rx: hipWidth * 0.53, rz: hipDepth },
      { y: 0.15 * s, rx: hipWidth * 0.48, rz: hipDepth * 0.9 },
      { y: 0.22 * s, rx: waistWidth * 0.53, rz: waistDepth * 1.02 },
    ]), skin);
    hips.add(pelvis);

    const spine = this.joint('spine', hips, 0, 0.20 * s, 0);
    const abdomen = makeMesh(sectionGeometry([
      { y: -0.02 * s, rx: waistWidth * 0.52, rz: waistDepth },
      { y: 0.10 * s, rx: waistWidth * 0.5, rz: waistDepth * 0.98 },
      { y: 0.23 * s, rx: chestWidth * 0.46, rz: chestDepth * 0.9 },
    ]), skin);
    spine.add(abdomen);

    const chest = this.joint('chest', spine, 0, 0.22 * s, 0);
    const ribcage = makeMesh(sectionGeometry([
      { y: -0.02 * s, rx: chestWidth * 0.45, rz: chestDepth * 0.88 },
      { y: 0.11 * s, rx: chestWidth * 0.53, rz: chestDepth },
      { y: 0.25 * s, rx: chestWidth * 0.55, rz: chestDepth * 0.96 },
    ]), skin);
    chest.add(ribcage);

    const upperChest = this.joint('upperChest', chest, 0, 0.23 * s, 0);
    const shoulderTorso = makeMesh(sectionGeometry([
      { y: -0.015 * s, rx: chestWidth * 0.53, rz: chestDepth * 0.94 },
      { y: 0.09 * s, rx: shoulderWidth * 0.47, rz: chestDepth * 0.86 },
      { y: 0.16 * s, rx: shoulderWidth * 0.50, rz: chestDepth * 0.78 },
    ]), skin);
    upperChest.add(shoulderTorso);

    const neck = this.joint('neck', upperChest, 0, 0.17 * s, 0);
    const neckMesh = makeMesh(new THREE.CylinderGeometry(0.057 * s, 0.065 * s, 0.12 * s, 22), skin);
    neckMesh.position.y = 0.06 * s;
    neck.add(neckMesh);
    const head = this.joint('head', neck, 0, 0.13 * s, 0);
    this.createFace(head, f, s, skin);

    const armTop = 0.064 * s * (0.92 + build * 0.08);
    const armBottom = 0.052 * s * (0.92 + build * 0.08);
    this.createArm('left', upperChest, -shoulderWidth * 0.52, 0.105 * s, upperArmL, lowerArmL, armTop, armBottom, skin, s);
    this.createArm('right', upperChest, shoulderWidth * 0.52, 0.105 * s, upperArmL, lowerArmL, armTop, armBottom, skin, s);

    const thighTop = 0.105 * s * (0.88 + hipWidth * 0.25) * build;
    const calfTop = 0.075 * s * (0.9 + build * 0.1);
    this.createLeg('left', hips, -hipWidth * 0.27, -0.055 * s, upperLegL, lowerLegL, thighTop, calfTop, skin, s);
    this.createLeg('right', hips, hipWidth * 0.27, -0.055 * s, upperLegL, lowerLegL, thighTop, calfTop, skin, s);

    this.rebuildWardrobe();
  }

  private createArm(side: 'left' | 'right', parent: THREE.Object3D, x: number, y: number, upperL: number, lowerL: number, topR: number, lowerR: number, skin: THREE.Material, s: number): void {
    const shoulder = this.joint(`${side}Shoulder`, parent, x, y, 0);
    const shoulderBall = ellipsoid(topR * 1.12, topR * 1.02, topR * 1.12, skin, 22);
    shoulder.add(shoulderBall);
    const upper = this.joint(`${side}UpperArm`, shoulder, 0, -topR * 0.35, 0);
    upper.add(taperedLimb(upperL, topR, lowerR * 1.05, skin));
    const lower = this.joint(`${side}LowerArm`, upper, 0, -upperL, 0);
    lower.add(taperedLimb(lowerL, lowerR * 1.04, lowerR * 0.72, skin));
    const hand = this.joint(`${side}Hand`, lower, 0, -lowerL, 0);
    const handMesh = ellipsoid(0.053 * s, 0.088 * s, 0.028 * s, skin, 22);
    handMesh.position.y = -0.065 * s;
    hand.add(handMesh);
  }

  private createLeg(side: 'left' | 'right', parent: THREE.Object3D, x: number, y: number, upperL: number, lowerL: number, thighR: number, calfR: number, skin: THREE.Material, s: number): void {
    const upper = this.joint(`${side}UpperLeg`, parent, x, y, 0);
    upper.add(taperedLimb(upperL, thighR, calfR * 1.06, skin));
    const lower = this.joint(`${side}LowerLeg`, upper, 0, -upperL, 0);
    lower.add(taperedLimb(lowerL, calfR, calfR * 0.72, skin));
    const foot = this.joint(`${side}Foot`, lower, 0, -lowerL, 0);
    const footMesh = ellipsoid(0.078 * s, 0.055 * s, 0.145 * s, skin, 24);
    footMesh.position.set(0, -0.03 * s, 0.07 * s);
    foot.add(footMesh);
  }

  private createFace(head: THREE.Group, f: FaceProfile, s: number, skin: THREE.Material): void {
    const faceW = 0.205 * s;
    const faceH = faceW * THREE.MathUtils.clamp(f.faceAspect, 1.05, 1.6);
    const depth = faceW * 0.78;
    const skull = ellipsoid(faceW, faceH * 0.57, depth, skin, 36);
    skull.position.y = faceH * 0.04;
    head.add(skull);

    const jawRatio = THREE.MathUtils.clamp(f.jawWidth, 0.5, 0.92);
    const jaw = ellipsoid(faceW * jawRatio * 0.82, faceH * 0.29, depth * 0.79, skin, 30);
    jaw.position.set(0, -faceH * 0.23, 0.012 * s);
    head.add(jaw);

    const hairMat = material(f.hairColor, 0.88);
    const hair = makeMesh(new THREE.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.61), hairMat);
    hair.scale.set(faceW * 1.04, faceH * 0.62, depth * 1.03);
    hair.position.y = faceH * 0.11;
    head.add(hair);

    const eyeSpacing = faceW * THREE.MathUtils.clamp(f.eyeSpacing * 1.38, 0.3, 0.65);
    const eyeWidth = faceW * THREE.MathUtils.clamp(f.eyeWidth * 1.8, 0.22, 0.43);
    const eyeY = faceH * 0.055;
    const featureZ = depth * 0.88;
    const eyeWhite = material('#fbfbfc', 0.42);
    const iris = material('#34343b', 0.5);

    const makeEye = (x: number): THREE.Mesh => {
      const eye = ellipsoid(eyeWidth * 0.5, eyeWidth * 0.25, eyeWidth * 0.12, eyeWhite, 24);
      eye.position.set(x, eyeY, featureZ);
      head.add(eye);
      const pupil = ellipsoid(eyeWidth * 0.13, eyeWidth * 0.13, eyeWidth * 0.05, iris, 18);
      pupil.position.set(x, eyeY, featureZ + eyeWidth * 0.095);
      head.add(pupil);
      return eye;
    };
    this.leftEye = makeEye(-eyeSpacing * 0.5);
    this.rightEye = makeEye(eyeSpacing * 0.5);

    const browMat = material(f.hairColor, 0.86);
    const makeBrow = (x: number): THREE.Mesh => {
      const brow = makeMesh(new THREE.BoxGeometry(eyeWidth * 0.88, 0.012 * s, 0.012 * s), browMat);
      brow.position.set(x, eyeY + eyeWidth * 0.31, featureZ + 0.012 * s);
      head.add(brow);
      return brow;
    };
    this.leftBrow = makeBrow(-eyeSpacing * 0.5);
    this.rightBrow = makeBrow(eyeSpacing * 0.5);

    const noseLength = faceH * THREE.MathUtils.clamp(f.noseLength, 0.15, 0.36);
    const noseWidth = faceW * THREE.MathUtils.clamp(f.noseWidth, 0.12, 0.34);
    const nose = makeMesh(new THREE.ConeGeometry(noseWidth * 0.33, noseLength * 0.62, 18), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -faceH * 0.045, featureZ + noseLength * 0.14);
    head.add(nose);

    const lipMat = material('#a85862', 0.6);
    const mouthW = faceW * THREE.MathUtils.clamp(f.mouthWidth, 0.25, 0.6);
    const mouthH = Math.max(0.012 * s, faceH * THREE.MathUtils.clamp(f.mouthHeight, 0.02, 0.1));
    this.mouth = ellipsoid(mouthW * 0.5, mouthH * 0.5, 0.012 * s, lipMat, 22);
    this.mouth.position.set(0, -faceH * 0.23, featureZ + 0.012 * s);
    head.add(this.mouth);
  }

  private rebuildWardrobe(): void {
    const remove: THREE.Object3D[] = [];
    this.root.traverse((obj) => { if (obj.userData.outfit) remove.push(obj); });
    for (const obj of remove) obj.parent?.remove(obj);
    if (!this.bodyProfile) return;

    const b = this.bodyProfile;
    const s = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
    const build = b.buildScale;
    const shoulderWidth = 0.50 * s * b.shoulderScale * (0.93 + build * 0.07);
    const chestWidth = 0.41 * s * b.chestScale * build;
    const waistWidth = 0.31 * s * b.waistScale * build;
    const hipWidth = 0.39 * s * b.hipScale * build;
    const chestDepth = 0.205 * s * (0.88 + b.chestScale * 0.12) * build;
    const waistDepth = 0.155 * s * (0.9 + build * 0.1);
    const hipDepth = 0.205 * s * (0.9 + b.hipScale * 0.1) * build;
    const topMat = material(this.outfit.topColor, this.outfit.top === 'jacket' ? 0.58 : 0.78);
    const bottomMat = material(this.outfit.bottomColor, 0.82);
    const shoeMat = material(this.outfit.shoeColor, 0.64);

    const spine = this.bones.get('spine');
    const chest = this.bones.get('chest');
    const upperChest = this.bones.get('upperChest');
    const hips = this.bones.get('hips');
    if (!spine || !chest || !upperChest || !hips) return;

    const tight = this.outfit.top === 'bodysuit' || this.outfit.top === 'tank' ? 1.035 : this.outfit.top === 'hoodie' ? 1.12 : this.outfit.top === 'jacket' ? 1.1 : 1.065;
    const abdomenTop = makeMesh(sectionGeometry([
      { y: -0.015 * s, rx: waistWidth * 0.53 * tight, rz: waistDepth * tight },
      { y: 0.10 * s, rx: waistWidth * 0.51 * tight, rz: waistDepth * tight },
      { y: 0.235 * s, rx: chestWidth * 0.47 * tight, rz: chestDepth * 0.92 * tight },
    ]), topMat);
    tagOutfit(abdomenTop); spine.add(abdomenTop);
    const chestTop = makeMesh(sectionGeometry([
      { y: -0.02 * s, rx: chestWidth * 0.46 * tight, rz: chestDepth * 0.9 * tight },
      { y: 0.12 * s, rx: chestWidth * 0.54 * tight, rz: chestDepth * tight },
      { y: 0.255 * s, rx: chestWidth * 0.56 * tight, rz: chestDepth * 0.96 * tight },
    ]), topMat);
    tagOutfit(chestTop); chest.add(chestTop);
    const upperTop = makeMesh(sectionGeometry([
      { y: -0.02 * s, rx: chestWidth * 0.54 * tight, rz: chestDepth * 0.94 * tight },
      { y: 0.09 * s, rx: shoulderWidth * 0.47 * tight, rz: chestDepth * 0.86 * tight },
      { y: 0.15 * s, rx: shoulderWidth * 0.49 * tight, rz: chestDepth * 0.78 * tight },
    ]), topMat);
    tagOutfit(upperTop); upperChest.add(upperTop);

    if (this.outfit.top === 'tshirt' || this.outfit.top === 'hoodie' || this.outfit.top === 'jacket') {
      for (const side of ['left', 'right'] as const) {
        const upperArm = this.bones.get(`${side}UpperArm`);
        if (!upperArm) continue;
        const sleeveL = this.outfit.top === 'tshirt' ? 0.14 * s : 0.31 * s * b.armScale;
        const sleeve = makeMesh(new THREE.CylinderGeometry(0.076 * s * tight, 0.082 * s * tight, sleeveL, 22), topMat);
        sleeve.position.y = -sleeveL / 2;
        tagOutfit(sleeve); upperArm.add(sleeve);
        if (this.outfit.top !== 'tshirt') {
          const lowerArm = this.bones.get(`${side}LowerArm`);
          if (lowerArm) {
            const foreL = 0.28 * s * b.armScale;
            const foreSleeve = makeMesh(new THREE.CylinderGeometry(0.058 * s * tight, 0.07 * s * tight, foreL, 22), topMat);
            foreSleeve.position.y = -foreL / 2;
            tagOutfit(foreSleeve); lowerArm.add(foreSleeve);
          }
        }
      }
    }

    const pelvisShell = makeMesh(sectionGeometry([
      { y: -0.095 * s, rx: hipWidth * 0.43 * 1.055, rz: hipDepth * 0.88 * 1.055 },
      { y: 0.02 * s, rx: hipWidth * 0.54 * 1.055, rz: hipDepth * 1.055 },
      { y: 0.15 * s, rx: hipWidth * 0.49 * 1.055, rz: hipDepth * 0.91 * 1.055 },
      { y: 0.205 * s, rx: waistWidth * 0.53 * 1.045, rz: waistDepth * 1.045 },
    ]), bottomMat);
    tagOutfit(pelvisShell); hips.add(pelvisShell);

    if (this.outfit.bottom === 'skirt') {
      const skirt = makeMesh(new THREE.CylinderGeometry(hipWidth * 0.56, hipWidth * 0.78, 0.42 * s, 30, 1, true), bottomMat);
      skirt.position.y = -0.16 * s;
      tagOutfit(skirt); hips.add(skirt);
    } else {
      const upperCoverage = this.outfit.bottom === 'shorts' ? 0.18 * s : 0.455 * s * b.legScale;
      const lowerCoverage = this.outfit.bottom === 'shorts' ? 0 : 0.43 * s * b.legScale;
      for (const side of ['left', 'right'] as const) {
        const upper = this.bones.get(`${side}UpperLeg`);
        const lower = this.bones.get(`${side}LowerLeg`);
        if (upper) {
          const upperShell = makeMesh(new THREE.CylinderGeometry(0.087 * s * build, 0.112 * s * build, upperCoverage, 24), bottomMat);
          upperShell.position.y = -upperCoverage / 2;
          tagOutfit(upperShell); upper.add(upperShell);
        }
        if (lower && lowerCoverage > 0) {
          const lowerShell = makeMesh(new THREE.CylinderGeometry(0.058 * s * build, 0.079 * s * build, lowerCoverage, 24), bottomMat);
          lowerShell.position.y = -lowerCoverage / 2;
          tagOutfit(lowerShell); lower.add(lowerShell);
        }
      }
    }

    if (this.outfit.shoes !== 'barefoot') {
      for (const side of ['left', 'right'] as const) {
        const foot = this.bones.get(`${side}Foot`);
        if (!foot) continue;
        const shoe = ellipsoid(0.09 * s, this.outfit.shoes === 'boots' ? 0.09 * s : 0.065 * s, 0.17 * s, shoeMat, 24);
        shoe.position.set(0, -0.035 * s, 0.075 * s);
        tagOutfit(shoe); foot.add(shoe);
        if (this.outfit.shoes === 'boots') {
          const lower = this.bones.get(`${side}LowerLeg`);
          if (lower) {
            const boot = makeMesh(new THREE.CylinderGeometry(0.072 * s, 0.082 * s, 0.22 * s, 22), shoeMat);
            boot.position.y = -0.34 * s;
            tagOutfit(boot); lower.add(boot);
          }
        }
      }
    }
  }

  private resetExpressionGeometry(): void {
    if (this.mouth) this.mouth.scale.set(1, 1, 1);
    if (this.leftEye) this.leftEye.scale.y = 1;
    if (this.rightEye) this.rightEye.scale.y = 1;
    if (this.leftBrow) this.leftBrow.rotation.z = 0;
    if (this.rightBrow) this.rightBrow.rotation.z = 0;
  }

  private clearJointRotations(): void {
    for (const joint of this.bones.values()) joint.rotation.set(0, 0, 0);
    this.resetExpressionGeometry();
  }

  private async performWave(side: 'left' | 'right'): Promise<void> {
    const sign = side === 'left' ? -1 : 1;
    const upper = `${side}UpperArm`;
    const lower = `${side}LowerArm`;
    const hand = `${side}Hand`;
    this.setBoneRotation(upper, 'z', 72 * sign);
    this.setBoneRotation(lower, 'x', -76);
    for (let i = 0; i < 5; i += 1) {
      this.setBoneRotation(hand, 'z', i % 2 === 0 ? -32 : 32);
      await sleep(140);
    }
    this.setBoneRotation(hand, 'z', 0);
  }

  private createRoom(): void {
    const floorMat = material('#171923', 0.94);
    const floor = makeMesh(new THREE.PlaneGeometry(10, 10), floorMat, false);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const bed = new THREE.Group();
    const frameMat = material('#33261f', 0.86);
    const linenMat = material('#ded8e4', 0.9);
    const accentMat = material('#8c78b9', 0.88);
    const frame = makeMesh(new THREE.BoxGeometry(1.65, 0.28, 2.75), frameMat);
    frame.position.set(0, 0.23, -0.66);
    bed.add(frame);
    const mattress = makeMesh(new THREE.BoxGeometry(1.58, 0.28, 2.62), linenMat);
    mattress.position.set(0, 0.48, -0.66);
    bed.add(mattress);
    const blanket = makeMesh(new THREE.BoxGeometry(1.5, 0.035, 1.2), accentMat);
    blanket.position.set(0, 0.64, 0.05);
    bed.add(blanket);
    const pillow = ellipsoid(0.48, 0.12, 0.33, linenMat, 24);
    pillow.position.set(0, 0.68, -1.63);
    bed.add(pillow);
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
