import './style.css';
import { VrmController } from './vrmController';
import { parseDirectorCommand } from './commandParser';
import { ChatEngine } from './chatEngine';
import { deleteCharacter, listCharacters, saveCharacter, storedCharacterToFile, type StoredCharacter } from './characterStore';
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
        <div id="stageEmpty" class="empty-stage">
          <div class="orb">A</div>
          <strong>No character loaded</strong>
          <span>Import a VRM anime character from your phone.</span>
          <button id="stageImport" class="primary">Import VRM</button>
        </div>
      </div>
      <div class="stage-overlay">
        <span id="activeCharacter" class="pill">No character</span>
        <span id="statusPill" class="pill subtle">Ready</span>
      </div>
    </section>

    <section id="panel-character" class="panel active">
      <div class="section-heading">
        <div><h2>Characters</h2><p>Import once, then switch instantly.</p></div>
        <button id="importCharacter" class="secondary">Import</button>
      </div>
      <div id="characterList" class="character-list"></div>
      <div class="mini-note">Use VRM models you own or have permission to use. Imported models stay on this device.</div>
    </section>

    <section id="panel-director" class="panel">
      <div class="section-heading">
        <div><h2>Director</h2><p>Exact commands override chat behaviour.</p></div>
        <button id="resetPose" class="secondary">Reset</button>
      </div>

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

      <details open>
        <summary>Manual bone control</summary>
        <div class="manual-grid">
          <label>Bone<select id="boneSelect"></select></label>
          <label>Axis<select id="axisSelect"><option>x</option><option>y</option><option>z</option></select></label>
          <label class="wide">Angle <span id="angleValue">0°</span><input id="angleRange" type="range" min="-180" max="180" value="0" step="1" /></label>
        </div>
      </details>

      <details>
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
          <code>look up 15 degrees</code>
          <code>bend left elbow 70 degrees</code>
          <code>set happy 0.8</code>
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
      <div class="mini-note">Manual Director commands never depend on the AI endpoint. Endpoint credentials are stored locally on this device in this first build.</div>
    </section>

    <nav class="bottom-nav">
      <button class="nav-item active" data-panel="character"><span>◇</span>Characters</button>
      <button class="nav-item" data-panel="director"><span>✦</span>Director</button>
      <button class="nav-item" data-panel="chat"><span>◌</span>Chat</button>
      <button class="nav-item" data-panel="settings"><span>⚙</span>Settings</button>
    </nav>

    <input id="vrmInput" type="file" accept=".vrm,model/gltf-binary" hidden />
  </main>
`;

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

const stage = $('#stage');
const stageEmpty = $('#stageEmpty');
const activeCharacter = $('#activeCharacter');
const statusPill = $('#statusPill');
const vrmInput = $<HTMLInputElement>('#vrmInput');
const characterList = $('#characterList');
const directorInput = $<HTMLTextAreaElement>('#directorInput');
const directorResult = $('#directorResult');
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
let characters: StoredCharacter[] = [];
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

function refreshRigControls(): void {
  setOptions(boneSelect, controller.listBones(), 'Load a VRM first');
  setOptions(expressionSelect, controller.listExpressions(), 'No expressions found');
  angleRange.value = '0';
  expressionRange.value = '0';
  angleValue.textContent = '0°';
  expressionValue.textContent = '0%';
}

async function loadCharacter(item: StoredCharacter): Promise<void> {
  setStatus('Loading…', true);
  try {
    const displayName = await controller.loadFile(storedCharacterToFile(item));
    currentCharacterId = item.id;
    activeCharacter.textContent = displayName || item.name;
    stageEmpty.classList.add('hidden');
    const settings = readSettings();
    if (!settings.characterName) {
      settings.characterName = displayName || item.name;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      fillSettings();
    }
    refreshRigControls();
    renderCharacterList();
    setStatus('Loaded');
  } catch (error) {
    setStatus('Load failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Could not load this character.';
  }
}

async function importCharacter(file: File): Promise<void> {
  setStatus('Importing…', true);
  try {
    const displayName = await controller.loadFile(file);
    const stored = await saveCharacter(displayName || file.name.replace(/\.vrm$/i, ''), file);
    currentCharacterId = stored.id;
    activeCharacter.textContent = stored.name;
    stageEmpty.classList.add('hidden');
    characters = await listCharacters();
    refreshRigControls();
    renderCharacterList();
    setStatus('Imported');
  } catch (error) {
    setStatus('Import failed');
    directorResult.textContent = error instanceof Error ? error.message : 'Import failed.';
  }
}

function renderCharacterList(): void {
  if (!characters.length) {
    characterList.innerHTML = `<button id="emptyImport" class="character-empty"><span class="avatar-chip">＋</span><span><strong>Import your first character</strong><small>VRM 0.x or VRM 1.0</small></span></button>`;
    document.querySelector('#emptyImport')?.addEventListener('click', () => vrmInput.click());
    return;
  }

  characterList.innerHTML = characters.map((item) => `
    <div class="character-row ${item.id === currentCharacterId ? 'selected' : ''}" data-id="${item.id}">
      <button class="character-main" data-load="${item.id}">
        <span class="avatar-chip">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.fileName)}</small></span>
      </button>
      <button class="delete-character" data-delete="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">×</button>
    </div>`).join('');

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
      if (currentCharacterId === id) currentCharacterId = '';
      renderCharacterList();
    });
  });
}

async function executeDirector(text: string): Promise<void> {
  if (!controller.hasCharacter()) {
    directorResult.textContent = 'Load a character first.';
    switchPanel('character');
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

vrmInput.addEventListener('change', () => {
  const file = vrmInput.files?.[0];
  if (file) void importCharacter(file);
  vrmInput.value = '';
});

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
  const value = Number(angleRange.value);
  angleValue.textContent = `${value}°`;
  if (boneSelect.value) controller.setBoneRotation(boneSelect.value, axisSelect.value as 'x' | 'y' | 'z', value);
});
expressionRange.addEventListener('input', () => {
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
  characters = await listCharacters();
  renderCharacterList();
  refreshRigControls();
}

void start();
