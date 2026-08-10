import { FaceAvatarController } from './face3dController';
import { parseDirectorCommand } from './commandParser';

interface Face3DCharacter {
  id: string;
  name: string;
  blob: Blob;
  fileName: string;
  createdAt: number;
}

const DB_NAME = 'anicontroller-face3d-db';
const STORE_NAME = 'avatars';
const DB_VERSION = 1;

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

async function saveFaceAvatar(name: string, file: File): Promise<Face3DCharacter> {
  const db = await openDb();
  const item: Face3DCharacter = {
    id: crypto.randomUUID(),
    name,
    blob: file,
    fileName: file.name,
    createdAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
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
    stageActions.insertAdjacentHTML('afterbegin', '<button id="stageFace3d" class="primary" type="button">Face → 3D</button>');
  }

  const headingActions = document.querySelector('#panel-character .heading-actions');
  if (headingActions && !document.querySelector('#face3dCharacter')) {
    headingActions.insertAdjacentHTML('afterbegin', '<button id="face3dCharacter" class="primary" type="button">Face → 3D</button>');
  }

  const photoStudio = document.querySelector('#photoStudio');
  if (photoStudio && !document.querySelector('#face3dStudio')) {
    photoStudio.insertAdjacentHTML('beforebegin', `
      <div id="face3dStudio" class="photo-studio hidden">
        <div class="photo-preview-wrap"><img id="face3dPreview" alt="Face for 3D avatar" /></div>
        <div class="photo-studio-controls">
          <label>Avatar name<input id="face3dName" placeholder="Character name" /></label>
          <div class="mode-note">Creates a real-time 3D full-body rig. The uploaded face is used as the visible face texture on a 3D head. A clear front-facing face photo works best.</div>
          <div class="photo-studio-actions">
            <button id="cancelFace3d" class="secondary" type="button">Cancel</button>
            <button id="createFace3d" class="primary" type="button">Create 3D avatar</button>
          </div>
        </div>
        <div class="mini-note">The first pose is lying on the bed. Face images stay on this device in local storage; the body is fully rigged for direct joint control.</div>
      </div>
    `);
  }

  const characterList = document.querySelector('#characterList');
  if (characterList && !document.querySelector('#face3dList')) {
    characterList.insertAdjacentHTML('beforebegin', '<div id="face3dList" class="character-list" style="margin-bottom:9px"></div>');
  }

  const shell = document.querySelector('.shell');
  if (shell && !document.querySelector('#face3dInput')) {
    shell.insertAdjacentHTML('beforeend', '<input id="face3dInput" type="file" accept="image/*" hidden />');
  }

  const quickGrid = document.querySelector('#panel-director .quick-grid');
  if (quickGrid && !document.querySelector('[data-face3d-command="lie on bed"]')) {
    quickGrid.insertAdjacentHTML('afterbegin', `
      <button data-face3d-command="lie on bed" type="button">Lie on bed</button>
      <button data-face3d-command="sit on bed" type="button">Sit</button>
      <button data-face3d-command="stand up" type="button">Stand</button>
    `);
  }

  const examples = document.querySelector('#panel-director .examples');
  if (examples) {
    examples.insertAdjacentHTML('afterbegin', `
      <code>lie on bed</code>
      <code>sit on bed then turn head left 20</code>
      <code>roll left</code>
      <code>rotate left upper leg x 45 then bend left elbow 70</code>
    `);
  }
}

injectUi();

const stage = $('#stage');
const controller = new FaceAvatarController(stage);
const faceInput = $<HTMLInputElement>('#face3dInput');
const faceStudio = $('#face3dStudio');
const facePreview = $<HTMLImageElement>('#face3dPreview');
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

let avatars: Face3DCharacter[] = [];
let activeFaceId = '';
let face3dActive = false;
let selectedFaceFile: File | null = null;
let previewUrl = '';

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
  controller.setVisible(false);
}

function activateRigControls(): void {
  const bones = controller.listBones();
  boneSelect.innerHTML = bones.map((bone) => `<option value="${escapeHtml(bone)}">${escapeHtml(bone)}</option>`).join('');
  boneSelect.disabled = false;
  axisSelect.disabled = false;
  angleRange.disabled = false;
  boneControls.classList.remove('disabled-control');

  expressionSelect.innerHTML = '<option value="">Photo-textured face</option>';
  expressionSelect.disabled = true;
  expressionRange.disabled = true;
  expressionControls.classList.add('disabled-control');
  expressionRange.value = '0';
  expressionValue.textContent = '0%';
  refreshBoneSlider();
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

async function loadFaceAvatar(item: Face3DCharacter): Promise<void> {
  setStatus('Building 3D avatar…', true);
  try {
    hideOtherCharacters();
    await controller.loadFace(item.blob);
    face3dActive = true;
    activeFaceId = item.id;
    activeCharacter.textContent = item.name;
    stageEmpty.classList.add('hidden');
    rigModeNote.textContent = 'Face-built 3D mode — full-body joint control is live. The neutral/reset pose is lying on the bed. Use exact bone controls or chained Director commands.';
    activateRigControls();
    renderFaceList();
    directorResult.textContent = '3D avatar ready on the bed. Tell it what to do.';
    setStatus('3D face avatar');
  } catch (error) {
    setStatus('3D build failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Could not create the 3D avatar.';
  }
}

function openFaceStudio(file: File): void {
  selectedFaceFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  facePreview.src = previewUrl;
  faceName.value = file.name.replace(/\.[^.]+$/, '') || '3D Character';
  faceStudio.classList.remove('hidden');
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
  document.querySelector('#panel-character')?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', (button as HTMLElement).dataset.panel === 'character'));
  faceStudio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeFaceStudio(): void {
  selectedFaceFile = null;
  faceStudio.classList.add('hidden');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  facePreview.removeAttribute('src');
}

async function createFaceAvatar(): Promise<void> {
  if (!selectedFaceFile) return;
  const button = $<HTMLButtonElement>('#createFace3d');
  button.disabled = true;
  setStatus('Creating full 3D body…', true);
  try {
    const name = faceName.value.trim() || '3D Character';
    const item = await saveFaceAvatar(name, selectedFaceFile);
    avatars = await listFaceAvatars();
    closeFaceStudio();
    await loadFaceAvatar(item);
  } finally {
    button.disabled = false;
  }
}

function renderFaceList(): void {
  if (!avatars.length) {
    faceList.innerHTML = '';
    return;
  }
  faceList.innerHTML = avatars.map((item) => `
    <div class="character-row ${item.id === activeFaceId ? 'selected' : ''}">
      <button class="character-main" data-face3d-load="${item.id}" type="button">
        <span class="avatar-chip">3D</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>Face-matched full-body rig · starts on bed</small></span>
      </button>
      <button class="delete-character" data-face3d-delete="${item.id}" type="button" aria-label="Delete ${escapeHtml(item.name)}">×</button>
    </div>
  `).join('');
}

async function executeDirector(text: string): Promise<void> {
  if (!face3dActive) return;
  const pieces = text.split(/\s*(?:;|\bthen\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (!pieces.length) return;
  setStatus('Executing live…', true);
  const summaries: string[] = [];

  for (const piece of pieces) {
    const normalized = piece.toLowerCase().replace(/°/g, ' degrees').trim();

    if ((normalized.includes('lie') || normalized.includes('lay') || normalized.includes('sleep')) && (normalized.includes('bed') || normalized.includes('down'))) {
      controller.lieOnBed();
      summaries.push('Lying on the bed.');
      continue;
    }
    if (normalized.includes('sit')) {
      controller.sitOnBed();
      summaries.push('Sitting on the bed.');
      continue;
    }
    if (normalized.includes('stand')) {
      controller.stand();
      summaries.push('Standing.');
      continue;
    }
    if (normalized.includes('roll') && normalized.includes('left')) {
      controller.rollOnBed('left');
      summaries.push('Rolled left on the bed.');
      continue;
    }
    if (normalized.includes('roll') && normalized.includes('right')) {
      controller.rollOnBed('right');
      summaries.push('Rolled right on the bed.');
      continue;
    }

    const parsed = parseDirectorCommand(piece);
    if (!parsed.actions.length) {
      summaries.push(parsed.summary);
      continue;
    }

    let supported = true;
    for (const action of parsed.actions) {
      const ok = await controller.execute(action);
      supported = supported && ok;
    }
    summaries.push(supported ? parsed.summary : `${parsed.summary} This face avatar does not have animated facial blendshapes yet.`);
  }

  directorResult.textContent = summaries.join(' ');
  setStatus('Ready');
  refreshBoneSlider();
}

function startFacePicker(): void {
  faceInput.click();
}

$('#stageFace3d').addEventListener('click', startFacePicker);
$('#face3dCharacter').addEventListener('click', startFacePicker);
faceInput.addEventListener('change', () => {
  const file = faceInput.files?.[0];
  if (file) openFaceStudio(file);
  faceInput.value = '';
});
$('#cancelFace3d').addEventListener('click', closeFaceStudio);
$('#createFace3d').addEventListener('click', () => void createFaceAvatar());

faceList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const load = target.closest<HTMLElement>('[data-face3d-load]');
  const remove = target.closest<HTMLElement>('[data-face3d-delete]');
  if (load) {
    const item = avatars.find((candidate) => candidate.id === load.dataset.face3dLoad);
    if (item) void loadFaceAvatar(item);
  }
  if (remove) {
    const id = remove.dataset.face3dDelete || '';
    void (async () => {
      await deleteFaceAvatar(id);
      avatars = await listFaceAvatars();
      if (activeFaceId === id) {
        activeFaceId = '';
        deactivateFace3d();
        stageEmpty.classList.remove('hidden');
        activeCharacter.textContent = 'No character';
        rigModeNote.textContent = 'Load a character to enable controls.';
      }
      renderFaceList();
    })();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const faceCommand = target.closest<HTMLElement>('[data-face3d-command]');
  if (faceCommand && face3dActive) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const command = faceCommand.dataset.face3dCommand || '';
    directorInput.value = command;
    void executeDirector(command);
    return;
  }

  if (!face3dActive) return;
  const otherCharacterAction = target.closest('[data-load], #importTop, #stageImport, #importCharacter, #stagePhoto, #photoCharacter');
  if (otherCharacterAction) deactivateFace3d();
}, true);

$('#directorForm').addEventListener('submit', (event) => {
  if (!face3dActive) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const command = directorInput.value.trim();
  if (command) void executeDirector(command);
}, true);

$('#resetPose').addEventListener('click', (event) => {
  if (!face3dActive) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  controller.lieOnBed();
  directorResult.textContent = 'Reset to lying on the bed.';
  refreshBoneSlider();
}, true);

boneSelect.addEventListener('change', (event) => {
  if (!face3dActive) return;
  event.stopImmediatePropagation();
  refreshBoneSlider();
}, true);

axisSelect.addEventListener('change', (event) => {
  if (!face3dActive) return;
  event.stopImmediatePropagation();
  refreshBoneSlider();
}, true);

angleRange.addEventListener('input', (event) => {
  if (!face3dActive) return;
  event.stopImmediatePropagation();
  const value = Number(angleRange.value);
  angleValue.textContent = `${value}°`;
  if (boneSelect.value) controller.setBoneRotation(boneSelect.value, axisSelect.value as 'x' | 'y' | 'z', value);
}, true);

async function start(): Promise<void> {
  avatars = await listFaceAvatars();
  renderFaceList();
}

void start();
