import { FaceAvatarController, DEFAULT_OUTFIT, type OutfitProfile } from './face3dController';
import { analyzeBody, analyzeFace, DEFAULT_BODY_PROFILE, type BodyProfile, type FaceProfile } from './avatarAnalysis';
import { parseDirectorCommand } from './commandParser';

interface Face3DCharacter {
  id: string;
  name: string;
  faceBlob: Blob;
  bodyBlob?: Blob;
  fileName: string;
  createdAt: number;
  faceProfile: FaceProfile;
  bodyProfile: BodyProfile;
  outfit: OutfitProfile;
  blob?: Blob;
}

const DB_NAME = 'anicontroller-face3d-db';
const STORE_NAME = 'avatars';
const DB_VERSION = 2;

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] || char);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

async function putAvatar(item: Face3DCharacter): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function saveFaceAvatar(name: string, faceFile: File, bodyFile: File | null, faceProfile: FaceProfile, bodyProfile: BodyProfile): Promise<Face3DCharacter> {
  const item: Face3DCharacter = {
    id: crypto.randomUUID(),
    name,
    faceBlob: faceFile,
    bodyBlob: bodyFile ?? undefined,
    fileName: faceFile.name,
    faceProfile,
    bodyProfile,
    outfit: { ...DEFAULT_OUTFIT },
    createdAt: Date.now(),
  };
  await putAvatar(item);
  return item;
}

async function listFaceAvatars(): Promise<Face3DCharacter[]> {
  const db = await openDb();
  const items = await new Promise<Face3DCharacter[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as Face3DCharacter[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

async function deleteFaceAvatar(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function injectUi(): void {
  const stageActions = document.querySelector('.stage-actions');
  if (stageActions && !document.querySelector('#stageFace3d')) {
    stageActions.insertAdjacentHTML('afterbegin', '<button id="stageFace3d" class="primary" type="button">Face → Real 3D</button>');
  }

  const headingActions = document.querySelector('#panel-character .heading-actions');
  if (headingActions && !document.querySelector('#face3dCharacter')) {
    headingActions.insertAdjacentHTML('afterbegin', '<button id="face3dCharacter" class="primary" type="button">Face → Real 3D</button>');
  }

  const photoStudio = document.querySelector('#photoStudio');
  if (photoStudio && !document.querySelector('#face3dStudio')) {
    photoStudio.insertAdjacentHTML('beforebegin', `
      <div id="face3dStudio" class="face3d-builder hidden">
        <div class="face3d-previews">
          <div><strong>Face photo</strong><div class="photo-preview-wrap"><img id="face3dPreview" alt="Face scan" /></div></div>
          <div><strong>Optional body photo</strong><button id="pickBody3d" class="character-empty" type="button"><span class="avatar-chip">＋</span><span><strong>Add full body photo</strong><small>Improves shoulder, hip, arm and leg proportions</small></span></button><div id="body3dPreviewWrap" class="photo-preview-wrap hidden"><img id="body3dPreview" alt="Body proportion scan" /></div></div>
        </div>
        <div class="settings-grid face3d-fields">
          <label>Avatar name<input id="face3dName" placeholder="Character name" /></label>
          <label>Height (cm)<input id="bodyHeight" type="number" min="130" max="220" value="170" /></label>
          <label>Shoulders <span id="shoulderLabel">100%</span><input id="shoulderScale" type="range" min="70" max="135" value="100" /></label>
          <label>Chest <span id="chestLabel">100%</span><input id="chestScale" type="range" min="70" max="140" value="100" /></label>
          <label>Waist <span id="waistLabel">100%</span><input id="waistScale" type="range" min="65" max="145" value="100" /></label>
          <label>Hips <span id="hipLabel">100%</span><input id="hipScale" type="range" min="70" max="145" value="100" /></label>
          <label>Arm length <span id="armLabel">100%</span><input id="armScale" type="range" min="82" max="120" value="100" /></label>
          <label>Leg length <span id="legLabel">100%</span><input id="legScale" type="range" min="82" max="120" value="100" /></label>
          <label class="wide">Overall build <span id="buildLabel">100%</span><input id="buildScale" type="range" min="75" max="135" value="100" /></label>
        </div>
        <div id="faceScanStatus" class="mode-note">A clear, front-facing face works best. The app detects facial landmarks and builds 3D geometry from the measurements; it does not identify who the person is.</div>
        <div class="photo-studio-actions">
          <button id="cancelFace3d" class="secondary" type="button">Cancel</button>
          <button id="createFace3d" class="primary" type="button">Scan & build avatar</button>
        </div>
      </div>
    `);
  }

  const characterList = document.querySelector('#characterList');
  if (characterList && !document.querySelector('#face3dList')) {
    characterList.insertAdjacentHTML('beforebegin', '<div id="face3dList" class="character-list" style="margin-bottom:9px"></div>');
  }

  const shell = document.querySelector('.shell');
  if (shell && !document.querySelector('#face3dInput')) {
    shell.insertAdjacentHTML('beforeend', '<input id="face3dInput" type="file" accept="image/*" hidden /><input id="body3dInput" type="file" accept="image/*" hidden />');
  }

  const quickGrid = document.querySelector('#panel-director .quick-grid');
  if (quickGrid && !document.querySelector('[data-face3d-command="lie on bed"]')) {
    quickGrid.insertAdjacentHTML('afterbegin', `
      <button data-face3d-command="lie on bed" type="button">Lie on bed</button>
      <button data-face3d-command="sit on bed" type="button">Sit</button>
      <button data-face3d-command="stand up" type="button">Stand</button>
    `);
  }

  const expressionControls = document.querySelector('#expressionControls');
  if (expressionControls && !document.querySelector('#wardrobeControls')) {
    expressionControls.insertAdjacentHTML('beforebegin', `
      <details id="wardrobeControls" open>
        <summary>Wardrobe</summary>
        <div class="manual-grid">
          <label>Top<select id="wardrobeTop"><option>tshirt</option><option>tank</option><option>hoodie</option><option>jacket</option><option>bodysuit</option></select></label>
          <label>Top color<input id="wardrobeTopColor" type="color" value="#6f66ff" /></label>
          <label>Bottom<select id="wardrobeBottom"><option>jeans</option><option>shorts</option><option>skirt</option><option>leggings</option></select></label>
          <label>Bottom color<input id="wardrobeBottomColor" type="color" value="#24283a" /></label>
          <label>Shoes<select id="wardrobeShoes"><option>sneakers</option><option>boots</option><option>barefoot</option></select></label>
          <label>Shoe color<input id="wardrobeShoeColor" type="color" value="#f2f2f4" /></label>
        </div>
      </details>
    `);
  }

  const examples = document.querySelector('#panel-director .examples');
  if (examples) {
    examples.insertAdjacentHTML('afterbegin', `
      <code>wear black hoodie then sit on bed</code>
      <code>change bottom to jeans</code>
      <code>wear white sneakers</code>
      <code>lie on bed then turn head left 20 then raise right arm 60</code>
      <code>rotate left upper leg x 45 then bend left elbow 70</code>
    `);
  }

  const style = document.createElement('style');
  style.textContent = `
    .face3d-builder{margin-bottom:14px;padding:14px;background:linear-gradient(135deg,rgba(105,91,255,.13),rgba(255,118,200,.06));border:1px solid rgba(155,124,255,.3);border-radius:19px;display:grid;gap:13px}
    .face3d-previews{display:grid;grid-template-columns:1fr 1fr;gap:10px}.face3d-previews>div{display:grid;gap:7px;font-size:11px;color:#bfc5d8}.face3d-previews .photo-preview-wrap{height:180px}.face3d-fields{padding:0}.face3d-fields input[type=range]{margin-top:2px}
    @media(max-width:560px){.face3d-previews{grid-template-columns:1fr}.face3d-previews .photo-preview-wrap{height:150px}}
  `;
  document.head.appendChild(style);
}

injectUi();

const stage = $('#stage');
const controller = new FaceAvatarController(stage);
const faceInput = $<HTMLInputElement>('#face3dInput');
const bodyInput = $<HTMLInputElement>('#body3dInput');
const faceStudio = $('#face3dStudio');
const facePreview = $<HTMLImageElement>('#face3dPreview');
const bodyPreview = $<HTMLImageElement>('#body3dPreview');
const bodyPreviewWrap = $('#body3dPreviewWrap');
const faceName = $<HTMLInputElement>('#face3dName');
const faceList = $('#face3dList');
const activeCharacter = $('#activeCharacter');
const statusPill = $('#statusPill');
const stageEmpty = $('#stageEmpty');
const photoAvatar = $<HTMLImageElement>('#photoAvatar');
const rigModeNote = $('#rigModeNote');
const directorResult = $('#directorResult');
const directorInput = $<HTMLTextAreaElement>('#directorInput');
const boneSelect = $<HTMLSelectElement>('#boneSelect');
const axisSelect = $<HTMLSelectElement>('#axisSelect');
const angleRange = $<HTMLInputElement>('#angleRange');
const angleValue = $('#angleValue');
const expressionSelect = $<HTMLSelectElement>('#expressionSelect');
const expressionRange = $<HTMLInputElement>('#expressionRange');
const expressionValue = $('#expressionValue');
const boneControls = $<HTMLDetailsElement>('#boneControls');
const expressionControls = $<HTMLDetailsElement>('#expressionControls');
const scanStatus = $('#faceScanStatus');
const wardrobeTop = $<HTMLSelectElement>('#wardrobeTop');
const wardrobeBottom = $<HTMLSelectElement>('#wardrobeBottom');
const wardrobeShoes = $<HTMLSelectElement>('#wardrobeShoes');
const wardrobeTopColor = $<HTMLInputElement>('#wardrobeTopColor');
const wardrobeBottomColor = $<HTMLInputElement>('#wardrobeBottomColor');
const wardrobeShoeColor = $<HTMLInputElement>('#wardrobeShoeColor');

let avatars: Face3DCharacter[] = [];
let activeFaceId = '';
let activeItem: Face3DCharacter | null = null;
let face3dActive = false;
let selectedFaceFile: File | null = null;
let selectedBodyFile: File | null = null;
let facePreviewUrl = '';
let bodyPreviewUrl = '';

function setStatus(text: string, busy = false): void {
  statusPill.textContent = text;
  statusPill.classList.toggle('busy', busy);
}

function hideOtherCharacters(): void {
  document.querySelectorAll<HTMLCanvasElement>('.vrm-canvas').forEach((canvas) => { canvas.style.display = 'none'; });
  photoAvatar.classList.add('hidden');
}

function deactivateFace3d(): void {
  if (!face3dActive) return;
  face3dActive = false;
  activeItem = null;
  controller.setVisible(false);
}

function numberInput(id: string, fallback: number): number {
  const value = Number($<HTMLInputElement>(`#${id}`).value);
  return Number.isFinite(value) ? value : fallback;
}

function readBodyProfile(): BodyProfile {
  return {
    heightCm: Math.min(220, Math.max(130, numberInput('bodyHeight', 170))),
    shoulderScale: numberInput('shoulderScale', 100) / 100,
    chestScale: numberInput('chestScale', 100) / 100,
    waistScale: numberInput('waistScale', 100) / 100,
    hipScale: numberInput('hipScale', 100) / 100,
    armScale: numberInput('armScale', 100) / 100,
    legScale: numberInput('legScale', 100) / 100,
    buildScale: numberInput('buildScale', 100) / 100,
    source: selectedBodyFile ? 'photo' : 'manual',
  };
}

function fillBodyProfile(profile: BodyProfile): void {
  $<HTMLInputElement>('#bodyHeight').value = String(Math.round(profile.heightCm));
  const entries: Array<[string, string, number]> = [
    ['shoulderScale', 'shoulderLabel', profile.shoulderScale], ['chestScale', 'chestLabel', profile.chestScale],
    ['waistScale', 'waistLabel', profile.waistScale], ['hipScale', 'hipLabel', profile.hipScale],
    ['armScale', 'armLabel', profile.armScale], ['legScale', 'legLabel', profile.legScale], ['buildScale', 'buildLabel', profile.buildScale],
  ];
  for (const [input, label, value] of entries) {
    $<HTMLInputElement>(`#${input}`).value = String(Math.round(value * 100));
    $(`#${label}`).textContent = `${Math.round(value * 100)}%`;
  }
}

function activateRigControls(): void {
  const bones = controller.listBones();
  boneSelect.innerHTML = bones.map((bone) => `<option value="${escapeHtml(bone)}">${escapeHtml(bone)}</option>`).join('');
  boneSelect.disabled = false;
  axisSelect.disabled = false;
  angleRange.disabled = false;
  boneControls.classList.remove('disabled-control');
  expressionSelect.innerHTML = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'blink', 'relaxed'].map((v) => `<option value="${v}">${v}</option>`).join('');
  expressionSelect.disabled = false;
  expressionRange.disabled = false;
  expressionControls.classList.remove('disabled-control');
  refreshBoneSlider();
}

function refreshWardrobeUi(): void {
  const outfit = controller.getOutfit();
  wardrobeTop.value = outfit.top;
  wardrobeBottom.value = outfit.bottom;
  wardrobeShoes.value = outfit.shoes;
  wardrobeTopColor.value = outfit.topColor;
  wardrobeBottomColor.value = outfit.bottomColor;
  wardrobeShoeColor.value = outfit.shoeColor;
}

function refreshBoneSlider(): void {
  if (!face3dActive || !boneSelect.value) return;
  const rotation = controller.getBoneRotation(boneSelect.value);
  if (!rotation) return;
  const axis = axisSelect.value as 'x' | 'y' | 'z';
  const value = Math.round(rotation[axis]);
  angleRange.value = String(value);
  angleValue.textContent = `${value}°`;
}

async function ensureProfiles(item: Face3DCharacter): Promise<Face3DCharacter> {
  const legacyBlob = item.faceBlob ?? item.blob;
  if (!legacyBlob) throw new Error('This saved avatar has no source face photo.');
  let changed = false;
  if (!item.faceBlob) { item.faceBlob = legacyBlob; changed = true; }
  if (!item.faceProfile) { item.faceProfile = await analyzeFace(legacyBlob); changed = true; }
  if (!item.bodyProfile) { item.bodyProfile = { ...DEFAULT_BODY_PROFILE }; changed = true; }
  if (!item.outfit) { item.outfit = { ...DEFAULT_OUTFIT }; changed = true; }
  if (changed) await putAvatar(item);
  return item;
}

async function loadFaceAvatar(raw: Face3DCharacter): Promise<void> {
  setStatus('Building measured 3D avatar…', true);
  try {
    const item = await ensureProfiles(raw);
    hideOtherCharacters();
    controller.configure(item.faceProfile, item.bodyProfile, item.outfit);
    face3dActive = true;
    activeFaceId = item.id;
    activeItem = item;
    activeCharacter.textContent = item.name;
    stageEmpty.classList.add('hidden');
    rigModeNote.textContent = `Landmark-built 3D mode — face geometry measured from the photo; body ${item.bodyProfile.source === 'photo' ? 'ratios measured from the body photo' : 'proportions are editable'}. Full joint, expression and wardrobe control is live.`;
    activateRigControls();
    refreshWardrobeUi();
    renderFaceList();
    directorResult.textContent = '3D avatar ready on the bed. Movement and clothing commands are live.';
    setStatus('Measured 3D avatar');
  } catch (error) {
    setStatus('3D build failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Could not create the 3D avatar.';
  }
}

function openFaceStudio(file: File): void {
  selectedFaceFile = file;
  selectedBodyFile = null;
  fillBodyProfile({ ...DEFAULT_BODY_PROFILE });
  if (facePreviewUrl) URL.revokeObjectURL(facePreviewUrl);
  facePreviewUrl = URL.createObjectURL(file);
  facePreview.src = facePreviewUrl;
  faceName.value = file.name.replace(/\.[^.]+$/, '') || '3D Character';
  bodyPreviewWrap.classList.add('hidden');
  scanStatus.textContent = 'Ready to scan facial landmarks. Add a standing full-body photo if you want body ratios estimated too.';
  faceStudio.classList.remove('hidden');
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
  document.querySelector('#panel-character')?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', (button as HTMLElement).dataset.panel === 'character'));
  faceStudio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeFaceStudio(): void {
  selectedFaceFile = null;
  selectedBodyFile = null;
  faceStudio.classList.add('hidden');
  if (facePreviewUrl) URL.revokeObjectURL(facePreviewUrl);
  if (bodyPreviewUrl) URL.revokeObjectURL(bodyPreviewUrl);
  facePreviewUrl = bodyPreviewUrl = '';
  facePreview.removeAttribute('src');
  bodyPreview.removeAttribute('src');
}

async function applyBodyPhoto(file: File): Promise<void> {
  selectedBodyFile = file;
  if (bodyPreviewUrl) URL.revokeObjectURL(bodyPreviewUrl);
  bodyPreviewUrl = URL.createObjectURL(file);
  bodyPreview.src = bodyPreviewUrl;
  bodyPreviewWrap.classList.remove('hidden');
  scanStatus.textContent = 'Scanning body proportions…';
  try {
    const heightCm = numberInput('bodyHeight', 170);
    const measured = await analyzeBody(file, heightCm);
    fillBodyProfile({ ...readBodyProfile(), ...measured, source: 'photo' });
    scanStatus.textContent = 'Body landmarks detected. Shoulder, hip, arm and leg ratios were updated; adjust any slider before building if needed.';
  } catch (error) {
    scanStatus.textContent = error instanceof Error ? error.message : 'Body scan failed. You can still set the proportions manually.';
  }
}

async function createFaceAvatar(): Promise<void> {
  if (!selectedFaceFile) return;
  const button = $<HTMLButtonElement>('#createFace3d');
  button.disabled = true;
  setStatus('Detecting face landmarks…', true);
  scanStatus.textContent = 'Detecting facial geometry on-device…';
  try {
    const faceProfile = await analyzeFace(selectedFaceFile);
    scanStatus.textContent = 'Face detected. Building parametric 3D head and rig…';
    let bodyProfile = readBodyProfile();
    if (selectedBodyFile && bodyProfile.source !== 'photo') {
      bodyProfile = { ...bodyProfile, ...(await analyzeBody(selectedBodyFile, bodyProfile.heightCm)), source: 'photo' };
    }
    const name = faceName.value.trim() || '3D Character';
    const item = await saveFaceAvatar(name, selectedFaceFile, selectedBodyFile, faceProfile, bodyProfile);
    avatars = await listFaceAvatars();
    closeFaceStudio();
    await loadFaceAvatar(item);
  } catch (error) {
    setStatus('Scan failed');
    scanStatus.textContent = error instanceof Error ? error.message : 'Could not detect the face.';
  } finally {
    button.disabled = false;
  }
}

function renderFaceList(): void {
  if (!avatars.length) { faceList.innerHTML = ''; return; }
  faceList.innerHTML = avatars.map((item) => `
    <div class="character-row ${item.id === activeFaceId ? 'selected' : ''}">
      <button class="character-main" data-face3d-load="${item.id}" type="button">
        <span class="avatar-chip">3D</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>Landmark 3D face · editable body · wardrobe</small></span>
      </button>
      <button class="delete-character" data-face3d-delete="${item.id}" type="button" aria-label="Delete ${escapeHtml(item.name)}">×</button>
    </div>
  `).join('');
}

const COLOR_WORDS: Record<string, string> = {
  black: '#16171c', white: '#f4f4f4', red: '#b93545', blue: '#365cb8', navy: '#202b51', pink: '#d967a5', purple: '#7654b5', green: '#3c835c', grey: '#777b86', gray: '#777b86', brown: '#6c4939', yellow: '#d6b445', orange: '#d47736',
};

function colorFromCommand(text: string): string | undefined {
  for (const [name, value] of Object.entries(COLOR_WORDS)) if (text.includes(name)) return value;
  const hex = text.match(/#[0-9a-f]{6}\b/i)?.[0];
  return hex;
}

async function persistOutfit(): Promise<void> {
  if (!activeItem) return;
  activeItem.outfit = controller.getOutfit();
  await putAvatar(activeItem);
}

function wardrobeCommand(text: string): string | null {
  const n = text.toLowerCase();
  const color = colorFromCommand(n);
  if (/\b(t-?shirt|tee)\b/.test(n)) { controller.setOutfit({ top: 'tshirt', ...(color ? { topColor: color } : {}) }); void persistOutfit(); return 'Changed into a t-shirt.'; }
  if (/\btank( top)?\b/.test(n)) { controller.setOutfit({ top: 'tank', ...(color ? { topColor: color } : {}) }); void persistOutfit(); return 'Changed into a tank top.'; }
  if (/\bhoodie\b/.test(n)) { controller.setOutfit({ top: 'hoodie', ...(color ? { topColor: color } : {}) }); void persistOutfit(); return 'Changed into a hoodie.'; }
  if (/\bjacket\b/.test(n)) { controller.setOutfit({ top: 'jacket', ...(color ? { topColor: color } : {}) }); void persistOutfit(); return 'Changed into a jacket.'; }
  if (/\bbodysuit\b/.test(n) || /remove top/.test(n)) { controller.setOutfit({ top: 'bodysuit', ...(color ? { topColor: color } : {}) }); void persistOutfit(); return 'Top changed to the base bodysuit.'; }
  if (/\bjeans\b/.test(n)) { controller.setOutfit({ bottom: 'jeans', ...(color ? { bottomColor: color } : {}) }); void persistOutfit(); return 'Changed into jeans.'; }
  if (/\bshorts\b/.test(n)) { controller.setOutfit({ bottom: 'shorts', ...(color ? { bottomColor: color } : {}) }); void persistOutfit(); return 'Changed into shorts.'; }
  if (/\bskirt\b/.test(n)) { controller.setOutfit({ bottom: 'skirt', ...(color ? { bottomColor: color } : {}) }); void persistOutfit(); return 'Changed into a skirt.'; }
  if (/\bleggings\b/.test(n) || /remove (pants|bottom)/.test(n)) { controller.setOutfit({ bottom: 'leggings', ...(color ? { bottomColor: color } : {}) }); void persistOutfit(); return 'Bottom changed to leggings.'; }
  if (/\bsneakers?\b/.test(n)) { controller.setOutfit({ shoes: 'sneakers', ...(color ? { shoeColor: color } : {}) }); void persistOutfit(); return 'Changed shoes to sneakers.'; }
  if (/\bboots?\b/.test(n)) { controller.setOutfit({ shoes: 'boots', ...(color ? { shoeColor: color } : {}) }); void persistOutfit(); return 'Changed shoes to boots.'; }
  if (/\bbarefoot\b/.test(n) || /remove shoes/.test(n)) { controller.setOutfit({ shoes: 'barefoot' }); void persistOutfit(); return 'Shoes removed.'; }
  return null;
}

async function executeDirector(text: string): Promise<void> {
  if (!face3dActive) return;
  const pieces = text.split(/\s*(?:;|\bthen\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (!pieces.length) return;
  setStatus('Executing live…', true);
  const summaries: string[] = [];

  for (const piece of pieces) {
    const normalized = piece.toLowerCase().replace(/°/g, ' degrees').trim();
    const clothes = wardrobeCommand(normalized);
    if (clothes) { summaries.push(clothes); refreshWardrobeUi(); continue; }
    if ((normalized.includes('lie') || normalized.includes('lay') || normalized.includes('sleep')) && (normalized.includes('bed') || normalized.includes('down'))) { controller.lieOnBed(); summaries.push('Lying on the bed.'); continue; }
    if (normalized.includes('sit')) { controller.sitOnBed(); summaries.push('Sitting on the bed.'); continue; }
    if (normalized.includes('stand')) { controller.stand(); summaries.push('Standing.'); continue; }
    if (normalized.includes('roll') && normalized.includes('left')) { controller.rollOnBed('left'); summaries.push('Rolled left on the bed.'); continue; }
    if (normalized.includes('roll') && normalized.includes('right')) { controller.rollOnBed('right'); summaries.push('Rolled right on the bed.'); continue; }

    const parsed = parseDirectorCommand(piece);
    if (!parsed.actions.length) { summaries.push(parsed.summary); continue; }
    let supported = true;
    for (const action of parsed.actions) supported = (await controller.execute(action)) && supported;
    summaries.push(supported ? parsed.summary : `${parsed.summary} One requested control was not available on this rig.`);
  }

  directorResult.textContent = summaries.join(' ');
  setStatus('Ready');
  refreshBoneSlider();
}

function startFacePicker(): void { faceInput.click(); }
$('#stageFace3d').addEventListener('click', startFacePicker);
$('#face3dCharacter').addEventListener('click', startFacePicker);
faceInput.addEventListener('change', () => { const file = faceInput.files?.[0]; if (file) openFaceStudio(file); faceInput.value = ''; });
$('#pickBody3d').addEventListener('click', () => bodyInput.click());
bodyInput.addEventListener('change', () => { const file = bodyInput.files?.[0]; if (file) void applyBodyPhoto(file); bodyInput.value = ''; });
$('#cancelFace3d').addEventListener('click', closeFaceStudio);
$('#createFace3d').addEventListener('click', () => void createFaceAvatar());

for (const id of ['shoulderScale', 'chestScale', 'waistScale', 'hipScale', 'armScale', 'legScale', 'buildScale']) {
  $<HTMLInputElement>(`#${id}`).addEventListener('input', () => {
    const label = id.replace('Scale', 'Label');
    $(`#${label}`).textContent = `${$<HTMLInputElement>(`#${id}`).value}%`;
  });
}

faceList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const load = target.closest<HTMLElement>('[data-face3d-load]');
  const remove = target.closest<HTMLElement>('[data-face3d-delete]');
  if (load) { const item = avatars.find((candidate) => candidate.id === load.dataset.face3dLoad); if (item) void loadFaceAvatar(item); }
  if (remove) {
    const id = remove.dataset.face3dDelete || '';
    void (async () => {
      await deleteFaceAvatar(id); avatars = await listFaceAvatars();
      if (activeFaceId === id) { activeFaceId = ''; deactivateFace3d(); stageEmpty.classList.remove('hidden'); activeCharacter.textContent = 'No character'; rigModeNote.textContent = 'Load a character to enable controls.'; }
      renderFaceList();
    })();
  }
});

function syncWardrobeFromUi(): void {
  if (!face3dActive) return;
  controller.setOutfit({
    top: wardrobeTop.value as OutfitProfile['top'], bottom: wardrobeBottom.value as OutfitProfile['bottom'], shoes: wardrobeShoes.value as OutfitProfile['shoes'],
    topColor: wardrobeTopColor.value, bottomColor: wardrobeBottomColor.value, shoeColor: wardrobeShoeColor.value,
  });
  void persistOutfit();
}
[wardrobeTop, wardrobeBottom, wardrobeShoes, wardrobeTopColor, wardrobeBottomColor, wardrobeShoeColor].forEach((el) => el.addEventListener('input', syncWardrobeFromUi));

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const faceCommand = target.closest<HTMLElement>('[data-face3d-command]');
  if (faceCommand && face3dActive) { event.preventDefault(); event.stopImmediatePropagation(); const command = faceCommand.dataset.face3dCommand || ''; directorInput.value = command; void executeDirector(command); return; }
  if (!face3dActive) return;
  const otherCharacterAction = target.closest('[data-load], #importTop, #stageImport, #importCharacter, #stagePhoto, #photoCharacter');
  if (otherCharacterAction) deactivateFace3d();
}, true);

$('#directorForm').addEventListener('submit', (event) => {
  if (!face3dActive) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const command = directorInput.value.trim(); if (command) void executeDirector(command);
}, true);

$('#resetPose').addEventListener('click', (event) => { if (!face3dActive) return; event.preventDefault(); event.stopImmediatePropagation(); controller.lieOnBed(); directorResult.textContent = 'Reset to lying on the bed.'; refreshBoneSlider(); }, true);
boneSelect.addEventListener('change', (event) => { if (!face3dActive) return; event.stopImmediatePropagation(); refreshBoneSlider(); }, true);
axisSelect.addEventListener('change', (event) => { if (!face3dActive) return; event.stopImmediatePropagation(); refreshBoneSlider(); }, true);
angleRange.addEventListener('input', (event) => { if (!face3dActive) return; event.stopImmediatePropagation(); const value = Number(angleRange.value); angleValue.textContent = `${value}°`; if (boneSelect.value) controller.setBoneRotation(boneSelect.value, axisSelect.value as 'x' | 'y' | 'z', value); }, true);
expressionRange.addEventListener('input', (event) => { if (!face3dActive) return; event.stopImmediatePropagation(); const value = Number(expressionRange.value); expressionValue.textContent = `${value}%`; controller.setExpression(expressionSelect.value, value / 100); }, true);
expressionSelect.addEventListener('change', (event) => { if (!face3dActive) return; event.stopImmediatePropagation(); expressionRange.value = '0'; expressionValue.textContent = '0%'; controller.setExpression('neutral', 0); }, true);

async function start(): Promise<void> { avatars = await listFaceAvatars(); renderFaceList(); }
void start();
