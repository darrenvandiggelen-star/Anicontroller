import * as THREE from 'three';
import { FaceAvatarController, type AdultBodyPreset, type OutfitProfile } from './face3dController';
import type { BodyProfile, FaceProfile } from './avatarAnalysis';

type BodySex = 'female' | 'male';

type ControllerInternals = {
  root: THREE.Group;
  bones: Map<string, THREE.Group>;
  faceProfile: FaceProfile | null;
  bodyProfile: BodyProfile | null;
  originalBodyProfile: BodyProfile | null;
  outfit: OutfitProfile;
  mouth: THREE.Mesh | null;
  leftEye: THREE.Mesh | null;
  rightEye: THREE.Mesh | null;
  leftBrow: THREE.Mesh | null;
  rightBrow: THREE.Mesh | null;
  poseMode: 'bed' | 'stand' | 'sit';
  __realBodySex?: BodySex;
  createFace(head: THREE.Group, face: FaceProfile, scale: number, skin: THREE.Material): void;
  rebuildAvatar(): void;
  rebuildWardrobe(): void;
  rebuildKeepingPose(): void;
};

type ControllerPrototype = {
  configure(face: FaceProfile, body: BodyProfile, outfit?: OutfitProfile): void;
  setAdultBodyPreset(preset: AdultBodyPreset): void;
  rebuildAvatar(this: ControllerInternals): void;
  rebuildWardrobe(this: ControllerInternals): void;
};

type CrossSection = {
  y: number;
  rx: number;
  front: number;
  back: number;
  zOffset?: number;
};

function bodyMaterial(color: string | number, roughness = 0.73): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.005 });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function humanSectionGeometry(sections: CrossSection[], radialSegments = 34): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const ring = radialSegments + 1;

  for (const section of sections) {
    for (let i = 0; i <= radialSegments; i += 1) {
      const angle = (i / radialSegments) * Math.PI * 2;
      const x = Math.cos(angle) * section.rx;
      const sine = Math.sin(angle);
      const depth = sine >= 0 ? section.front : section.back;
      const z = sine * depth + (section.zOffset ?? 0);
      positions.push(x, section.y, z);
    }
  }

  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let i = 0; i < radialSegments; i += 1) {
      const a = s * ring + i;
      const b = a + ring;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const bottom = positions.length / 3;
  positions.push(0, sections[0].y, sections[0].zOffset ?? 0);
  const top = positions.length / 3;
  positions.push(0, sections[sections.length - 1].y, sections[sections.length - 1].zOffset ?? 0);
  for (let i = 0; i < radialSegments; i += 1) {
    indices.push(bottom, i + 1, i);
    const base = (sections.length - 1) * ring;
    indices.push(top, base + i, base + i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipsoid(rx: number, ry: number, rz: number, material: THREE.Material, segments = 28): THREE.Mesh {
  const item = mesh(new THREE.SphereGeometry(1, segments, Math.max(16, Math.round(segments * 0.72))), material);
  item.scale.set(rx, ry, rz);
  return item;
}

function joint(self: ControllerInternals, name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, y, z);
  parent.add(group);
  self.bones.set(name, group);
  return group;
}

function limbGeometry(length: number, topX: number, topZ: number, midX: number, midZ: number, endX: number, endZ: number): THREE.BufferGeometry {
  return humanSectionGeometry([
    { y: 0, rx: topX, front: topZ, back: topZ * 0.96 },
    { y: -length * 0.46, rx: midX, front: midZ, back: midZ * 0.96 },
    { y: -length, rx: endX, front: endZ, back: endZ * 0.96 },
  ], 24);
}

function inferSex(self: ControllerInternals): BodySex {
  if (self.__realBodySex) return self.__realBodySex;
  const selected = document.querySelector<HTMLSelectElement>('#adultSex')?.value;
  if (selected === 'male' || selected === 'female') return selected;
  const b = self.bodyProfile;
  if (!b) return 'female';
  return b.shoulderScale >= 1.04 && b.hipScale <= 1.02 ? 'male' : 'female';
}

function removeTagged(root: THREE.Object3D, tag: string): void {
  const remove: THREE.Object3D[] = [];
  root.traverse((object) => { if (object.userData[tag]) remove.push(object); });
  for (const object of remove) object.parent?.remove(object);
}

function tag(object: THREE.Object3D, name: string): void {
  object.userData[name] = true;
  object.traverse((child) => { child.userData[name] = true; });
}

function addArm(
  self: ControllerInternals,
  side: 'left' | 'right',
  parent: THREE.Object3D,
  x: number,
  y: number,
  upperLength: number,
  lowerLength: number,
  upperRadius: number,
  skin: THREE.Material,
  scale: number,
): void {
  const shoulder = joint(self, `${side}Shoulder`, parent, x, y, 0);
  const shoulderContour = ellipsoid(upperRadius * 1.04, upperRadius * 0.86, upperRadius * 0.9, skin, 24);
  shoulderContour.position.y = -upperRadius * 0.08;
  shoulder.add(shoulderContour);

  const upper = joint(self, `${side}UpperArm`, shoulder, 0, -upperRadius * 0.23, 0);
  upper.add(mesh(limbGeometry(upperLength, upperRadius, upperRadius * 0.82, upperRadius * 0.9, upperRadius * 0.76, upperRadius * 0.72, upperRadius * 0.68), skin));

  const lower = joint(self, `${side}LowerArm`, upper, 0, -upperLength, 0);
  const forearmTop = upperRadius * 0.72;
  lower.add(mesh(limbGeometry(lowerLength, forearmTop, forearmTop * 0.8, forearmTop * 0.86, forearmTop * 0.73, forearmTop * 0.58, forearmTop * 0.62), skin));

  const hand = joint(self, `${side}Hand`, lower, 0, -lowerLength, 0);
  const handMesh = ellipsoid(0.047 * scale, 0.082 * scale, 0.022 * scale, skin, 24);
  handMesh.position.y = -0.062 * scale;
  hand.add(handMesh);
}

function addLeg(
  self: ControllerInternals,
  side: 'left' | 'right',
  parent: THREE.Object3D,
  x: number,
  y: number,
  upperLength: number,
  lowerLength: number,
  thighRadius: number,
  calfRadius: number,
  skin: THREE.Material,
  scale: number,
): void {
  const upper = joint(self, `${side}UpperLeg`, parent, x, y, 0);
  upper.add(mesh(humanSectionGeometry([
    { y: 0, rx: thighRadius, front: thighRadius * 0.86, back: thighRadius * 0.94 },
    { y: -upperLength * 0.48, rx: thighRadius * 0.88, front: thighRadius * 0.8, back: thighRadius * 0.86 },
    { y: -upperLength, rx: calfRadius * 0.83, front: calfRadius * 0.72, back: calfRadius * 0.75 },
  ], 26), skin));

  const lower = joint(self, `${side}LowerLeg`, upper, 0, -upperLength, 0);
  lower.add(mesh(humanSectionGeometry([
    { y: 0, rx: calfRadius * 0.82, front: calfRadius * 0.72, back: calfRadius * 0.75 },
    { y: -lowerLength * 0.32, rx: calfRadius, front: calfRadius * 0.82, back: calfRadius * 0.95 },
    { y: -lowerLength * 0.72, rx: calfRadius * 0.75, front: calfRadius * 0.68, back: calfRadius * 0.72 },
    { y: -lowerLength, rx: calfRadius * 0.57, front: calfRadius * 0.57, back: calfRadius * 0.6 },
  ], 26), skin));

  const foot = joint(self, `${side}Foot`, lower, 0, -lowerLength, 0);
  const footMesh = ellipsoid(0.072 * scale, 0.048 * scale, 0.14 * scale, skin, 26);
  footMesh.position.set(0, -0.025 * scale, 0.075 * scale);
  foot.add(footMesh);
}

const prototype = FaceAvatarController.prototype as unknown as ControllerPrototype;
const originalConfigure = prototype.configure;
const originalSetPreset = prototype.setAdultBodyPreset;

prototype.configure = function configure(face: FaceProfile, body: BodyProfile, outfit?: OutfitProfile): void {
  const self = this as unknown as ControllerInternals;
  const selected = document.querySelector<HTMLSelectElement>('#adultSex')?.value;
  if (selected === 'male' || selected === 'female') self.__realBodySex = selected;
  originalConfigure.call(this as unknown as FaceAvatarController, face, body, outfit);
};

prototype.setAdultBodyPreset = function setAdultBodyPreset(preset: AdultBodyPreset): void {
  const self = this as unknown as ControllerInternals;
  if (preset === 'masculine') self.__realBodySex = 'male';
  if (preset === 'feminine' || preset === 'curvy') self.__realBodySex = 'female';
  originalSetPreset.call(this as unknown as FaceAvatarController, preset);
};

prototype.rebuildAvatar = function rebuildAvatar(this: ControllerInternals): void {
  while (this.root.children.length) this.root.remove(this.root.children[0]);
  this.bones.clear();
  this.mouth = this.leftEye = this.rightEye = this.leftBrow = this.rightBrow = null;
  if (!this.faceProfile || !this.bodyProfile) return;

  const f = this.faceProfile;
  const b = this.bodyProfile;
  const sex = inferSex(this);
  const s = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
  const build = THREE.MathUtils.clamp(b.buildScale, 0.75, 1.35);

  const female = sex === 'female';
  const shoulderHalf = (female ? 0.205 : 0.235) * s * b.shoulderScale * (0.95 + build * 0.05);
  const chestHalf = (female ? 0.185 : 0.215) * s * b.chestScale * (0.95 + build * 0.05);
  const waistHalf = (female ? 0.142 : 0.165) * s * b.waistScale * (0.96 + build * 0.04);
  const hipHalf = (female ? 0.198 : 0.178) * s * b.hipScale * (0.95 + build * 0.05);

  // Human torsos are much flatter front-to-back than the previous rounded mannequin.
  const chestFront = (female ? 0.145 : 0.135) * s * (0.93 + b.chestScale * 0.07) * build;
  const chestBack = (female ? 0.105 : 0.115) * s * build;
  const waistFront = (female ? 0.105 : 0.115) * s * build;
  const waistBack = (female ? 0.095 : 0.105) * s * build;
  const hipFront = (female ? 0.125 : 0.115) * s * build;
  const hipBack = (female ? 0.14 : 0.125) * s * build;

  const upperArmLength = 0.33 * s * b.armScale;
  const lowerArmLength = 0.29 * s * b.armScale;
  const upperLegLength = 0.45 * s * b.legScale;
  const lowerLegLength = 0.43 * s * b.legScale;
  const skin = bodyMaterial(f.skinColor, 0.77);

  const hips = joint(this, 'hips', this.root, 0, upperLegLength + lowerLegLength + 0.08 * s, 0);
  const pelvis = mesh(humanSectionGeometry([
    { y: -0.075 * s, rx: hipHalf * 0.72, front: hipFront * 0.82, back: hipBack * 0.84 },
    { y: 0.015 * s, rx: hipHalf, front: hipFront, back: hipBack, zOffset: -0.006 * s },
    { y: 0.105 * s, rx: hipHalf * 0.96, front: hipFront * 0.96, back: hipBack * 1.02 },
    { y: 0.185 * s, rx: waistHalf * 1.06, front: waistFront * 1.04, back: waistBack * 1.06 },
  ]), skin);
  hips.add(pelvis);

  // Subtle glute contour, kept under the neutral coverage / clothing layer.
  const gluteRadiusX = hipHalf * 0.45;
  for (const x of [-hipHalf * 0.34, hipHalf * 0.34]) {
    const glute = ellipsoid(gluteRadiusX, 0.105 * s, 0.06 * s, skin, 24);
    glute.position.set(x, 0.045 * s, -hipBack * 0.83);
    hips.add(glute);
  }

  const spine = joint(this, 'spine', hips, 0, 0.18 * s, 0);
  const abdomen = mesh(humanSectionGeometry([
    { y: -0.005 * s, rx: waistHalf * 1.04, front: waistFront, back: waistBack },
    { y: 0.075 * s, rx: waistHalf, front: waistFront * 0.98, back: waistBack },
    { y: 0.155 * s, rx: chestHalf * 0.84, front: chestFront * 0.82, back: chestBack * 0.9 },
    { y: 0.205 * s, rx: chestHalf * 0.9, front: chestFront * 0.86, back: chestBack * 0.94 },
  ]), skin);
  spine.add(abdomen);

  const chest = joint(this, 'chest', spine, 0, 0.20 * s, 0);
  const ribcage = mesh(humanSectionGeometry([
    { y: -0.005 * s, rx: chestHalf * 0.88, front: chestFront * 0.84, back: chestBack * 0.94 },
    { y: 0.075 * s, rx: chestHalf * 0.98, front: chestFront * 0.94, back: chestBack },
    { y: 0.155 * s, rx: chestHalf, front: chestFront, back: chestBack },
    { y: 0.205 * s, rx: chestHalf * 0.96, front: chestFront * 0.91, back: chestBack * 0.94 },
  ]), skin);
  chest.add(ribcage);

  if (female) {
    // Anatomical chest volume beneath clothing; not a separate exposed nude surface.
    const chestContourMat = skin;
    const breastX = chestHalf * 0.43;
    const breastY = 0.12 * s;
    const breastZ = chestFront * 0.78;
    for (const x of [-breastX, breastX]) {
      const contour = ellipsoid(chestHalf * 0.34, 0.085 * s * b.chestScale, 0.045 * s * b.chestScale, chestContourMat, 26);
      contour.position.set(x, breastY, breastZ);
      chest.add(contour);
    }
  }

  const upperChest = joint(this, 'upperChest', chest, 0, 0.20 * s, 0);
  const upperTorso = mesh(humanSectionGeometry([
    { y: -0.004 * s, rx: chestHalf * 0.94, front: chestFront * 0.9, back: chestBack * 0.93 },
    { y: 0.065 * s, rx: shoulderHalf * 0.92, front: chestFront * 0.78, back: chestBack * 0.84 },
    { y: 0.125 * s, rx: shoulderHalf, front: chestFront * 0.69, back: chestBack * 0.76 },
    { y: 0.15 * s, rx: shoulderHalf * 0.9, front: chestFront * 0.62, back: chestBack * 0.7 },
  ]), skin);
  upperChest.add(upperTorso);

  const neck = joint(this, 'neck', upperChest, 0, 0.15 * s, 0);
  const neckMesh = mesh(new THREE.CylinderGeometry((female ? 0.046 : 0.052) * s, (female ? 0.055 : 0.061) * s, 0.115 * s, 24), skin);
  neckMesh.position.y = 0.058 * s;
  neck.add(neckMesh);

  const head = joint(this, 'head', neck, 0, 0.125 * s, 0);
  this.createFace(head, f, s, skin);

  const armRadius = (female ? 0.052 : 0.061) * s * (0.93 + build * 0.07);
  addArm(this, 'left', upperChest, -shoulderHalf * 1.03, 0.095 * s, upperArmLength, lowerArmLength, armRadius, skin, s);
  addArm(this, 'right', upperChest, shoulderHalf * 1.03, 0.095 * s, upperArmLength, lowerArmLength, armRadius, skin, s);

  const thighRadius = (female ? 0.094 : 0.09) * s * build * (0.94 + b.hipScale * 0.06);
  const calfRadius = (female ? 0.063 : 0.068) * s * (0.94 + build * 0.06);
  const legOffset = hipHalf * (female ? 0.47 : 0.43);
  addLeg(this, 'left', hips, -legOffset, -0.055 * s, upperLegLength, lowerLegLength, thighRadius, calfRadius, skin, s);
  addLeg(this, 'right', hips, legOffset, -0.055 * s, upperLegLength, lowerLegLength, thighRadius, calfRadius, skin, s);

  this.rebuildWardrobe();
};

prototype.rebuildWardrobe = function rebuildWardrobe(this: ControllerInternals): void {
  removeTagged(this.root, 'outfit');
  if (!this.bodyProfile) return;

  const b = this.bodyProfile;
  const sex = inferSex(this);
  const female = sex === 'female';
  const s = THREE.MathUtils.clamp(b.heightCm / 170, 0.78, 1.3);
  const build = THREE.MathUtils.clamp(b.buildScale, 0.75, 1.35);
  const shoulderHalf = (female ? 0.205 : 0.235) * s * b.shoulderScale * (0.95 + build * 0.05);
  const chestHalf = (female ? 0.185 : 0.215) * s * b.chestScale * (0.95 + build * 0.05);
  const waistHalf = (female ? 0.142 : 0.165) * s * b.waistScale * (0.96 + build * 0.04);
  const hipHalf = (female ? 0.198 : 0.178) * s * b.hipScale * (0.95 + build * 0.05);
  const chestFront = (female ? 0.145 : 0.135) * s * (0.93 + b.chestScale * 0.07) * build;
  const chestBack = (female ? 0.105 : 0.115) * s * build;
  const waistFront = (female ? 0.105 : 0.115) * s * build;
  const waistBack = (female ? 0.095 : 0.105) * s * build;
  const hipFront = (female ? 0.125 : 0.115) * s * build;
  const hipBack = (female ? 0.14 : 0.125) * s * build;

  const topMat = bodyMaterial(this.outfit.topColor, this.outfit.top === 'jacket' ? 0.58 : 0.8);
  const bottomMat = bodyMaterial(this.outfit.bottomColor, 0.83);
  const shoeMat = bodyMaterial(this.outfit.shoeColor, 0.65);
  const hips = this.bones.get('hips');
  const spine = this.bones.get('spine');
  const chest = this.bones.get('chest');
  const upperChest = this.bones.get('upperChest');
  if (!hips || !spine || !chest || !upperChest) return;

  const topFit = this.outfit.top === 'hoodie' ? 1.095 : this.outfit.top === 'jacket' ? 1.075 : this.outfit.top === 'tshirt' ? 1.045 : 1.025;
  const makeTop = (parent: THREE.Object3D, sections: CrossSection[]): void => {
    const item = mesh(humanSectionGeometry(sections.map((section) => ({
      ...section,
      rx: section.rx * topFit,
      front: section.front * topFit,
      back: section.back * topFit,
    }))), topMat);
    tag(item, 'outfit');
    parent.add(item);
  };

  makeTop(spine, [
    { y: -0.004 * s, rx: waistHalf * 1.04, front: waistFront, back: waistBack },
    { y: 0.075 * s, rx: waistHalf, front: waistFront * 0.98, back: waistBack },
    { y: 0.155 * s, rx: chestHalf * 0.84, front: chestFront * 0.82, back: chestBack * 0.9 },
    { y: 0.205 * s, rx: chestHalf * 0.9, front: chestFront * 0.86, back: chestBack * 0.94 },
  ]);
  makeTop(chest, [
    { y: -0.004 * s, rx: chestHalf * 0.88, front: chestFront * 0.84, back: chestBack * 0.94 },
    { y: 0.075 * s, rx: chestHalf * 0.98, front: chestFront * 0.94, back: chestBack },
    { y: 0.155 * s, rx: chestHalf, front: chestFront, back: chestBack },
    { y: 0.205 * s, rx: chestHalf * 0.96, front: chestFront * 0.91, back: chestBack * 0.94 },
  ]);
  makeTop(upperChest, [
    { y: -0.004 * s, rx: chestHalf * 0.94, front: chestFront * 0.9, back: chestBack * 0.93 },
    { y: 0.065 * s, rx: shoulderHalf * 0.92, front: chestFront * 0.78, back: chestBack * 0.84 },
    { y: 0.125 * s, rx: shoulderHalf, front: chestFront * 0.69, back: chestBack * 0.76 },
  ]);

  if (this.outfit.top === 'tshirt' || this.outfit.top === 'hoodie' || this.outfit.top === 'jacket') {
    for (const side of ['left', 'right'] as const) {
      const upper = this.bones.get(`${side}UpperArm`);
      if (!upper) continue;
      const longSleeve = this.outfit.top !== 'tshirt';
      const length = (longSleeve ? 0.325 : 0.135) * s * b.armScale;
      const radius = (female ? 0.055 : 0.064) * s * topFit;
      const sleeve = mesh(humanSectionGeometry([
        { y: 0, rx: radius, front: radius * 0.82, back: radius * 0.82 },
        { y: -length, rx: radius * 0.82, front: radius * 0.7, back: radius * 0.7 },
      ], 22), topMat);
      tag(sleeve, 'outfit');
      upper.add(sleeve);
      if (longSleeve) {
        const lower = this.bones.get(`${side}LowerArm`);
        if (!lower) continue;
        const foreLength = 0.285 * s * b.armScale;
        const fore = mesh(humanSectionGeometry([
          { y: 0, rx: radius * 0.82, front: radius * 0.7, back: radius * 0.7 },
          { y: -foreLength, rx: radius * 0.58, front: radius * 0.58, back: radius * 0.58 },
        ], 22), topMat);
        tag(fore, 'outfit');
        lower.add(fore);
      }
    }
  }

  // Neutral lower-body coverage is always present; clothing sits close to the anatomical base.
  const pelvisShell = mesh(humanSectionGeometry([
    { y: -0.075 * s, rx: hipHalf * 0.74, front: hipFront * 0.84, back: hipBack * 0.86 },
    { y: 0.015 * s, rx: hipHalf * 1.025, front: hipFront * 1.025, back: hipBack * 1.025 },
    { y: 0.105 * s, rx: hipHalf * 0.98, front: hipFront * 0.98, back: hipBack * 1.04 },
    { y: 0.185 * s, rx: waistHalf * 1.08, front: waistFront * 1.06, back: waistBack * 1.08 },
  ]), bottomMat);
  tag(pelvisShell, 'outfit');
  hips.add(pelvisShell);

  if (this.outfit.bottom === 'skirt') {
    const skirt = mesh(new THREE.CylinderGeometry(hipHalf * 1.02, hipHalf * 1.32, 0.39 * s, 34, 1, true), bottomMat);
    skirt.position.y = -0.13 * s;
    tag(skirt, 'outfit');
    hips.add(skirt);
  } else {
    const upperCoverage = this.outfit.bottom === 'shorts' ? 0.18 * s : 0.445 * s * b.legScale;
    const lowerCoverage = this.outfit.bottom === 'shorts' ? 0 : 0.42 * s * b.legScale;
    const thighRadius = (female ? 0.098 : 0.094) * s * build;
    const calfRadius = (female ? 0.066 : 0.071) * s * (0.95 + build * 0.05);
    for (const side of ['left', 'right'] as const) {
      const upper = this.bones.get(`${side}UpperLeg`);
      const lower = this.bones.get(`${side}LowerLeg`);
      if (upper) {
        const shell = mesh(humanSectionGeometry([
          { y: 0, rx: thighRadius * 1.025, front: thighRadius * 0.9, back: thighRadius * 0.98 },
          { y: -upperCoverage, rx: calfRadius * 0.88, front: calfRadius * 0.76, back: calfRadius * 0.8 },
        ], 24), bottomMat);
        tag(shell, 'outfit');
        upper.add(shell);
      }
      if (lower && lowerCoverage > 0) {
        const shell = mesh(humanSectionGeometry([
          { y: 0, rx: calfRadius * 0.88, front: calfRadius * 0.76, back: calfRadius * 0.8 },
          { y: -lowerCoverage * 0.35, rx: calfRadius * 1.02, front: calfRadius * 0.86, back: calfRadius },
          { y: -lowerCoverage, rx: calfRadius * 0.59, front: calfRadius * 0.59, back: calfRadius * 0.62 },
        ], 24), bottomMat);
        tag(shell, 'outfit');
        lower.add(shell);
      }
    }
  }

  if (this.outfit.shoes !== 'barefoot') {
    for (const side of ['left', 'right'] as const) {
      const foot = this.bones.get(`${side}Foot`);
      if (!foot) continue;
      const shoe = ellipsoid(0.082 * s, this.outfit.shoes === 'boots' ? 0.075 * s : 0.058 * s, 0.155 * s, shoeMat, 26);
      shoe.position.set(0, -0.03 * s, 0.078 * s);
      tag(shoe, 'outfit');
      foot.add(shoe);
    }
  }
};
