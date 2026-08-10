import './style.css';
import { VrmController } from './vrmController';
import { parseDirectorCommand } from './commandParser';
import { ChatEngine } from './chatEngine';
import {
  deleteCharacter,
  listCharacters,
  saveCharacter,
  storedCharacterToFile,
  type CharacterKind,
  type StoredCharacter,
} from './characterStore';
import { stylizePhoto, type AnimeStyle } from './photoStudio';
import type { ChatSettings } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="brand">ANICONTROLLER</div>
        <div class="subtitle">Live anime character director</div>
      </div>
      <button id="importTop" class="icon-button" aria-label="Import VRM">＋</button>
    </header>

    <section class="stage-card">
      <div id="stage" class="stage">
        <img id="photoAvatar" class="photo-avatar hidden" alt="Photo character" />
        <div id="stageEmpty" class="empty-stage">
          <div class="orb">A</div>
          <strong>No character loaded</strong>
          <span>Import a VRM or turn a photo into an anime-style character.</span>
          <div class="stage-actions">
            <button id="stagePhoto" class="primary">Photo → Anime</button>
            <button id="stageImport" class="secondary">Import VRM</button>
          </div>
        </div>
      </div>
      <div class="stage-overlay">
        <span id="activeCharacter" class="pill">No character</span>
        <span id="statusPill" class="pill subtle">Ready</span>
      </div>
    </section>

    <section id="panel-character" class="panel active">
      <div class="section-heading">
        <div><h2>Characters</h2><p>Create from a photo or import a full 3D VRM.</p></div>
        <div class="heading-actions">
          <button id="photoCharacter" class="secondary">Photo → Anime</button>
          <button id="importCharacter" class="secondary">VRM</button>
        </div>
      </div>

      <div id="photoStudio" class="photo-studio hidden">
        <div class="photo-preview-wrap"><img id="photoPreview" alt="Selected person" /></div>
        <div class="photo-studio-controls">
          <label>Anime look
            <select id="animeStyle">
              <option value="soft">Soft anime</option>
              <option value="cel" selected>Cel shaded</option>
              <option value="manga">Manga</option>
            </select>
          </label>
          <label>Character name<input id="photoCharacterName" placeholder="Character name" /></label>
          <div class="photo-studio-actions">
            <button id="cancelPhoto" class="secondary" type="button">Cancel</button>
            <button id="generateAnime" class="primary" type="button">Create anime character</button>
          </div>
        </div>
        <div class="mini-note">The built-in converter runs locally on your phone. It creates a stylized 2D avatar without uploading the original photo.</div>
      </div>

      <div id="characterList" class="character-list"></div>
      <div class="mini-note">VRM characters support precise body/bone control. Photo characters support whole-avatar motion; a flat photo cannot provide independent arm/leg bones without rigging.</div>
    </section>

    <section id="panel-director" class="panel">
      <div class="section-heading">
        <div><h2>Director</h2><p>Exact commands run separately from chat behaviour.</p></div>
        <button id="resetPose" class="secondary">Reset</button>
      </div>

      <div id="rigModeNote" class="mode-note">Load a character to enable controls.</div>

      <form id="directorForm" class="command-box">
        <textarea id="directorInput" rows="3" placeholder="e.g. raise right arm 45 degrees"></textarea>
        <button class="primary" type="submit">Execute command</button>
      </form>
      <div id="directorResult" class="result-line">Waiting for a command.</div>

      <div class="quick-grid">
        <button data-command="camera close">Face</button>
        <button data-command="camera front">Upper body</button>
        <button data-command="camera full">Full body</button>
        <button data-command="wave right">Wave</button>
        <button data-command="smile 80">Smile</button>
        <button data-command="reset pose">Neutral</button>
      </div>

      <details id="boneControls" open>
        <summary>Manual bone control</summary>
        <div class="manual-grid">
          <label>Bone<select id="boneSelect"></select></label>
          <label>Axis<select id="axisSelect"><option>x</option><option>y</option><option>z</option></select></label>
          <label class="wide">Angle <span id="angleValue">0°</span><input id="angleRange" type="range" min="-180" max="180" value="0" step="1" /></label>
        </div>
      </details>

      <details id="expressionControls">
        <summary>Facial expression</summary>
        <div class="manual-grid">
          <label class="wide">Expression<select id="expressionSelect"></select></label>
          <label class="wide">Weight <span id="expressionValue">0%</span><input id="expressionRange" type="range" min="0" max="100" value="0" step="1" /></label>
        </div>
      </details>

      <details>
        <summary>Command examples</summary>
        <div class="examples">
          <code>rotate right upper arm z 45</code>
          <code>turn head left 25 degrees</code>
          <code>bend left elbow 70 degrees</code>
          <code>set happy 0.8</code>
          <code>photo: tilt left 15</code>
          <code>photo: move right 40</code>
          <code>photo: zoom 125</code>
        </div>
      </details>
    </section>

    <section id="panel-chat" class="panel">
      <div class="section-heading">
        <div><h2>Live chat</h2><p>Conversation stays separate from Director controls.</p></div>
        <button id="clearChat" class="secondary">Clear</button>
      </div>
      <div id="chatLog" class="chat-log">
        <div class="bubble assistant">Load a character, then chat here. Configure an AI endpoint in Settings for generative replies.</div>
      </div>
      <form id="chatForm" class="chat-compose">
        <input id="chatInput" autocomplete="off" placeholder="Say something…" />
        <button class="primary" type="submit">Send</button>
      </form>
    </section>

    <section id="panel-settings" class="panel">
      <div class="section-heading"><div><h2>Settings</h2><p>Choose the character identity and AI backend.</p></div></div>
      <div class="settings-grid">
        <label>Character name<input id="characterName" placeholder="Aiko" /></label>
        <label>AI model<input id="modelName" placeholder="model name" /></label>
        <label class="wide">Personality<textarea id="personality" rows="4" placeholder="Describe how this character speaks and behaves."></textarea></label>
        <label class="wide">OpenAI-compatible endpoint<input id="endpoint" placeholder="https://example.com/v1" /></label>
        <label class="wide">API key<input id="apiKey" type="password" placeholder="Optional for local endpoints" /></label>
      </div>
      <button id="saveSettings" class="primary full">Save settings</button>
      <div class="mini-note">Director commands never depend on the conversational AI endpoint. Endpoint credentials are stored locally on this device in this first build.</div>
    </section>

    <nav class="bottom-nav">
      <button class="nav-item active" data-panel="character"><span>◇</span>Characters</button>
      <button class="nav-item" data-panel="director"><span>✦</span>Director</button>
      <button class="nav-item" data-panel="chat"><span>◌</span>Chat</button>
      <button class="nav-item" data-panel="settings"><span>⚙</span>Settings</button>
    </nav>

    <input id="vrmInput" type="file" accept=".vrm,model/gltf-binary" hidden />
    <input id="photoInput" type="file" accept="image/*" hidden />
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

const stage = $('#stage');
const stageEmpty = $('#stageEmpty');
const photoAvatar = $<HTMLImageElement>('#photoAvatar');
const activeCharacter = $('#activeCharacter');
const statusPill = $('#statusPill');
const vrmInput = $<HTMLInputElement>('#vrmInput');
const photoInput = $<HTMLInputElement>('#photoInput');
const characterList = $('#characterList');
const photoStudio = $('#photoStudio');
const photoPreview = $<HTMLImageElement>('#photoPreview');
const animeStyle = $<HTMLSelectElement>('#animeStyle');
const photoCharacterName = $<HTMLInputElement>('#photoCharacterName');
const directorInput = $<HTMLTextAreaElement>('#directorInput');
const directorResult = $('#directorResult');
const rigModeNote = $('#rigModeNote');
const boneControls = $<HTMLDetailsElement>('#boneControls');
const expressionControls = $<HTMLDetailsElement>('#expressionControls');
const boneSelect = $<HTMLSelectElement>('#boneSelect');
const axisSelect = $<HTMLSelectElement>('#axisSelect');
const angleRange = $<HTMLInputElement>('#angleRange');
const angleValue = $('#angleValue');
const expressionSelect = $<HTMLSelectElement>('#expressionSelect');
const expressionRange = $<HTMLInputElement>('#expressionRange');
const expressionValue = $('#expressionValue');
const chatLog = $('#chatLog');
const chatInput = $<HTMLInputElement>('#chatInput');

const SETTINGS_KEY = 'anicontroller-settings-v1';
let currentCharacterId = '';
let currentCharacterKind: CharacterKind | null = null;
let characters: StoredCharacter[] = [];
let selectedPhotoFile: File | null = null;
let photoPreviewUrl = '';
let photoAvatarUrl = '';
let photoRotation = 0;
let photoScale = 1;
let photoX = 0;
let photoY = 0;
const controller = new VrmController(stage);

function defaultSettings(): ChatSettings {
  return {
    characterName: '',
    personality: 'Friendly, expressive, natural and concise.',
    endpoint: '',
    apiKey: '',
    model: '',
  };
}

function readSettings(): ChatSettings {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaultSettings();
  }
}

function fillSettings(): void {
  const settings = readSettings();
  $<HTMLInputElement>('#characterName').value = settings.characterName;
  $<HTMLTextAreaElement>('#personality').value = settings.personality;
  $<HTMLInputElement>('#endpoint').value = settings.endpoint;
  $<HTMLInputElement>('#apiKey').value = settings.apiKey;
  $<HTMLInputElement>('#modelName').value = settings.model;
}

function collectSettings(): ChatSettings {
  return {
    characterName: $<HTMLInputElement>('#characterName').value.trim(),
    personality: $<HTMLTextAreaElement>('#personality').value.trim(),
    endpoint: $<HTMLInputElement>('#endpoint').value.trim(),
    apiKey: $<HTMLInputElement>('#apiKey').value.trim(),
    model: $<HTMLInputElement>('#modelName').value.trim(),
  };
}

const chat = new ChatEngine(readSettings);
fillSettings();

function setStatus(text: string, busy = false): void {
  statusPill.textContent = text;
  statusPill.classList.toggle('busy', busy);
}

function setOptions(select: HTMLSelectElement, values: string[], emptyText: string): void {
  select.innerHTML = values.length
    ? values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('')
    : `<option value="">${emptyText}</option>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] || char);
}

function setRigControlAvailability(enabled: boolean): void {
  boneSelect.disabled = !enabled;
  axisSelect.disabled = !enabled;
  angleRange.disabled = !enabled;
  expressionSelect.disabled = !enabled;
  expressionRange.disabled = !enabled;
  boneControls.classList.toggle('disabled-control', !enabled);
  expressionControls.classList.toggle('disabled-control', !enabled);
}

function refreshRigControls(): void {
  if (currentCharacterKind !== 'vrm') {
    setOptions(boneSelect, [], '3D VRM required');
    setOptions(expressionSelect, [], '3D VRM required');
    setRigControlAvailability(false);
  } else {
    setOptions(boneSelect, controller.listBones(), 'No humanoid bones found');
    setOptions(expressionSelect, controller.listExpressions(), 'No expressions found');
    setRigControlAvailability(true);
  }
  angleRange.value = '0';
  expressionRange.value = '0';
  angleValue.textContent = '0°';
  expressionValue.textContent = '0%';
}

function updateModeNote(): void {
  if (currentCharacterKind === 'vrm') {
    rigModeNote.textContent = '3D VRM mode — exact bone, pose, expression and camera controls are enabled.';
  } else if (currentCharacterKind === 'image') {
    rigModeNote.textContent = '2D photo-avatar mode — tilt, move, zoom, shake, nod and whole-avatar motion are enabled. Independent limbs require a rigged VRM.';
  } else {
    rigModeNote.textContent = 'Load a character to enable controls.';
  }
}

function applyPhotoTransform(): void {
  photoAvatar.style.transform = `translate(${photoX}px, ${photoY}px) rotate(${photoRotation}deg) scale(${photoScale})`;
}

function resetPhotoPose(): void {
  photoRotation = 0;
  photoScale = 1;
  photoX = 0;
  photoY = 0;
  applyPhotoTransform();
}

function showPhotoBlob(blob: Blob): void {
  if (photoAvatarUrl) URL.revokeObjectURL(photoAvatarUrl);
  photoAvatarUrl = URL.createObjectURL(blob);
  photoAvatar.src = photoAvatarUrl;
  photoAvatar.classList.remove('hidden');
  controller.setVisible(false);
  resetPhotoPose();
}

function hidePhotoAvatar(): void {
  photoAvatar.classList.add('hidden');
  if (photoAvatarUrl) {
    URL.revokeObjectURL(photoAvatarUrl);
    photoAvatarUrl = '';
  }
  photoAvatar.removeAttribute('src');
}

async function loadCharacter(item: StoredCharacter): Promise<void> {
  setStatus('Loading…', true);
  try {
    const kind = item.kind ?? 'vrm';
    currentCharacterId = item.id;
    currentCharacterKind = kind;

    if (kind === 'image') {
      showPhotoBlob(item.blob);
      activeCharacter.textContent = item.name;
      stageEmpty.classList.add('hidden');
    } else {
      hidePhotoAvatar();
      controller.setVisible(true);
      const displayName = await controller.loadFile(storedCharacterToFile(item));
      activeCharacter.textContent = displayName || item.name;
      stageEmpty.classList.add('hidden');
    }

    const settings = readSettings();
    if (!settings.characterName) {
      settings.characterName = item.name;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      fillSettings();
    }

    refreshRigControls();
    updateModeNote();
    renderCharacterList();
    setStatus(kind === 'image' ? 'Photo avatar' : '3D loaded');
  } catch (error) {
    setStatus('Load failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Could not load this character.';
  }
}

async function importCharacter(file: File): Promise<void> {
  setStatus('Importing…', true);
  try {
    hidePhotoAvatar();
    controller.setVisible(true);
    const displayName = await controller.loadFile(file);
    const stored = await saveCharacter(displayName || file.name.replace(/\.vrm$/i, ''), file, 'vrm');
    characters = await listCharacters();
    await loadCharacter(stored);
    setStatus('Imported');
  } catch (error) {
    setStatus('Import failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Import failed.';
  }
}

function renderCharacterList(): void {
  if (!characters.length) {
    characterList.innerHTML = `
      <div class="empty-character-grid">
        <button id="emptyPhoto" class="character-empty"><span class="avatar-chip">✦</span><span><strong>Create from a photo</strong><small>Local anime-style 2D avatar</small></span></button>
        <button id="emptyImport" class="character-empty"><span class="avatar-chip">＋</span><span><strong>Import a 3D character</strong><small>VRM 0.x or VRM 1.0</small></span></button>
      </div>`;
    document.querySelector('#emptyPhoto')?.addEventListener('click', () => photoInput.click());
    document.querySelector('#emptyImport')?.addEventListener('click', () => vrmInput.click());
    return;
  }

  characterList.innerHTML = characters.map((item) => {
    const kind = item.kind ?? 'vrm';
    return `
      <div class="character-row ${item.id === currentCharacterId ? 'selected' : ''}" data-id="${item.id}">
        <button class="character-main" data-load="${item.id}">
          <span class="avatar-chip">${kind === 'image' ? '✦' : escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>
          <span><strong>${escapeHtml(item.name)}</strong><small>${kind === 'image' ? '2D anime photo' : '3D VRM'} · ${escapeHtml(item.fileName)}</small></span>
        </button>
        <button class="delete-character" data-delete="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">×</button>
      </div>`;
  }).join('');

  characterList.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = characters.find((candidate) => candidate.id === button.dataset.load);
      if (item) void loadCharacter(item);
    });
  });

  characterList.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.delete || '';
      await deleteCharacter(id);
      characters = await listCharacters();
      if (currentCharacterId === id) {
        currentCharacterId = '';
        currentCharacterKind = null;
        hidePhotoAvatar();
        controller.setVisible(false);
        stageEmpty.classList.remove('hidden');
        activeCharacter.textContent = 'No character';
        refreshRigControls();
        updateModeNote();
      }
      renderCharacterList();
    });
  });
}

function openPhotoStudio(file: File): void {
  selectedPhotoFile = file;
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  photoPreview.src = photoPreviewUrl;
  photoCharacterName.value = file.name.replace(/\.[^.]+$/, '') || 'Anime Character';
  photoStudio.classList.remove('hidden');
  switchPanel('character');
  photoStudio.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePhotoStudio(): void {
  selectedPhotoFile = null;
  photoStudio.classList.add('hidden');
  if (photoPreviewUrl) {
    URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = '';
  }
  photoPreview.removeAttribute('src');
}

async function createAnimeCharacter(): Promise<void> {
  if (!selectedPhotoFile) return;
  setStatus('Creating anime…', true);
  const button = $<HTMLButtonElement>('#generateAnime');
  button.disabled = true;
  try {
    const style = animeStyle.value as AnimeStyle;
    const result = await stylizePhoto(selectedPhotoFile, style);
    const name = photoCharacterName.value.trim() || result.name.replace(/\.[^.]+$/, '');
    const stored = await saveCharacter(name, result, 'image');
    characters = await listCharacters();
    closePhotoStudio();
    await loadCharacter(stored);
    setStatus('Anime created');
  } catch (error) {
    setStatus('Create failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Could not create the anime image.';
  } finally {
    button.disabled = false;
  }
}

function numberFrom(text: string, fallback: number): number {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function playPhotoAnimation(name: 'bounce' | 'shake' | 'nod'): void {
  photoAvatar.classList.remove('photo-bounce', 'photo-shake', 'photo-nod');
  void photoAvatar.offsetWidth;
  photoAvatar.classList.add(`photo-${name}`);
  window.setTimeout(() => photoAvatar.classList.remove(`photo-${name}`), 900);
}

function executePhotoDirector(text: string): void {
  const command = text.toLowerCase().replace(/°/g, ' degrees').trim();

  if (/^(reset|reset pose|neutral|neutral pose)$/.test(command)) {
    resetPhotoPose();
    directorResult.textContent = '2D avatar reset.';
    return;
  }

  if (command.includes('camera') || command.includes('zoom')) {
    if (command.includes('close')) photoScale = 1.35;
    else if (command.includes('full')) photoScale = 0.9;
    else if (command.includes('front')) photoScale = 1.08;
    else photoScale = Math.max(0.5, Math.min(2.5, Math.abs(numberFrom(command, 100)) / 100));
    applyPhotoTransform();
    directorResult.textContent = `2D avatar zoom set to ${Math.round(photoScale * 100)}%.`;
    return;
  }

  if (command.includes('tilt') || command.startsWith('rotate')) {
    const amount = Math.max(0, Math.min(60, Math.abs(numberFrom(command, 15))));
    if (command.includes('left')) photoRotation = -amount;
    else if (command.includes('right')) photoRotation = amount;
    else photoRotation = Math.max(-60, Math.min(60, numberFrom(command, 0)));
    applyPhotoTransform();
    directorResult.textContent = `2D avatar tilt set to ${photoRotation}°.`;
    return;
  }

  if (command.includes('move')) {
    const amount = Math.max(0, Math.min(240, Math.abs(numberFrom(command, 30))));
    if (command.includes('left')) photoX -= amount;
    if (command.includes('right')) photoX += amount;
    if (command.includes('up')) photoY -= amount;
    if (command.includes('down')) photoY += amount;
    applyPhotoTransform();
    directorResult.textContent = `2D avatar moved to X ${photoX}px, Y ${photoY}px.`;
    return;
  }

  if (command.includes('bounce') || command.includes('jump')) {
    playPhotoAnimation('bounce');
    directorResult.textContent = '2D avatar bounce played.';
    return;
  }

  if (command.includes('shake')) {
    playPhotoAnimation('shake');
    directorResult.textContent = '2D avatar shake played.';
    return;
  }

  if (command.includes('nod')) {
    playPhotoAnimation('nod');
    directorResult.textContent = '2D avatar nod played.';
    return;
  }

  if (command.includes('wave') || command.includes('arm') || command.includes('leg') || command.includes('elbow') || command.includes('hand')) {
    directorResult.textContent = 'This is a flat 2D photo avatar, so it has no separate limb bones. Import or generate a rigged VRM for exact arm/leg movement.';
    return;
  }

  directorResult.textContent = '2D commands: tilt left/right, move left/right/up/down, zoom 125, bounce, shake, nod, reset pose.';
}

async function executeDirector(text: string): Promise<void> {
  if (!currentCharacterKind) {
    directorResult.textContent = 'Load a character first.';
    switchPanel('character');
    return;
  }

  if (currentCharacterKind === 'image') {
    setStatus('Executing…', true);
    executePhotoDirector(text);
    setStatus('Ready');
    return;
  }

  const parsed = parseDirectorCommand(text);
  if (!parsed.actions.length) {
    directorResult.textContent = parsed.summary;
    return;
  }

  setStatus('Executing…', true);
  const results = await Promise.all(parsed.actions.map((action) => controller.execute(action)));
  directorResult.textContent = results.every(Boolean) ? parsed.summary : `${parsed.summary} One or more controls are not supported by this VRM.`;
  setStatus('Ready');
  refreshBoneSlider();
}

function refreshBoneSlider(): void {
  if (currentCharacterKind !== 'vrm') return;
  const bone = boneSelect.value;
  if (!bone) return;
  const rotation = controller.getBoneRotation(bone);
  if (!rotation) return;
  const axis = axisSelect.value as 'x' | 'y' | 'z';
  const value = Math.round(rotation[axis]);
  angleRange.value = String(value);
  angleValue.textContent = `${value}°`;
}

function appendMessage(role: 'user' | 'assistant', content: string): void {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function switchPanel(name: string): void {
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
  document.querySelector(`#panel-${name}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', (button as HTMLElement).dataset.panel === name));
}

document.querySelectorAll<HTMLElement>('.nav-item').forEach((button) => button.addEventListener('click', () => switchPanel(button.dataset.panel || 'character')));
['#importTop', '#stageImport', '#importCharacter'].forEach((selector) => $(selector).addEventListener('click', () => vrmInput.click()));
['#stagePhoto', '#photoCharacter'].forEach((selector) => $(selector).addEventListener('click', () => photoInput.click()));

vrmInput.addEventListener('change', () => {
  const file = vrmInput.files?.[0];
  if (file) void importCharacter(file);
  vrmInput.value = '';
});

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (file) openPhotoStudio(file);
  photoInput.value = '';
});

$('#cancelPhoto').addEventListener('click', closePhotoStudio);
$('#generateAnime').addEventListener('click', () => void createAnimeCharacter());

$('#directorForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const command = directorInput.value.trim();
  if (command) void executeDirector(command);
});

document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => button.addEventListener('click', () => {
  const command = button.dataset.command || '';
  directorInput.value = command;
  void executeDirector(command);
}));

$('#resetPose').addEventListener('click', () => void executeDirector('reset pose'));
boneSelect.addEventListener('change', refreshBoneSlider);
axisSelect.addEventListener('change', refreshBoneSlider);
angleRange.addEventListener('input', () => {
  if (currentCharacterKind !== 'vrm') return;
  const value = Number(angleRange.value);
  angleValue.textContent = `${value}°`;
  if (boneSelect.value) controller.setBoneRotation(boneSelect.value, axisSelect.value as 'x' | 'y' | 'z', value);
});
expressionRange.addEventListener('input', () => {
  if (currentCharacterKind !== 'vrm') return;
  const value = Number(expressionRange.value);
  expressionValue.textContent = `${value}%`;
  if (expressionSelect.value) controller.setExpression(expressionSelect.value, value / 100);
});
expressionSelect.addEventListener('change', () => {
  expressionRange.value = '0';
  expressionValue.textContent = '0%';
});

$('#chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';
  appendMessage('user', message);
  setStatus('Thinking…', true);
  try {
    appendMessage('assistant', await chat.send(message));
    setStatus('Ready');
  } catch (error) {
    appendMessage('assistant', error instanceof Error ? error.message : 'Chat failed.');
    setStatus('Chat error');
  }
});

$('#clearChat').addEventListener('click', () => {
  chat.clear();
  chatLog.innerHTML = '<div class="bubble assistant">Chat cleared.</div>';
});

$('#saveSettings').addEventListener('click', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(collectSettings()));
  setStatus('Settings saved');
  window.setTimeout(() => setStatus('Ready'), 1200);
});

async function start(): Promise<void> {
  controller.setVisible(false);
  characters = await listCharacters();
  renderCharacterList();
  refreshRigControls();
  updateModeNote();
}

void start();
