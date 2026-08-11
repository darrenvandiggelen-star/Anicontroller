import { extractVideoPrompt, getCharacterReply, parseMotionPrompt } from './engine';
import { resizeImage, store } from './store';
import type { Character, Route, VideoJob, VisualStyle } from './types';
import { renderQuickClip, startPreview } from './video';
import { webLlm } from './web-llm';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function avatar(character: Character, className = 'avatar'): string {
  if (character.avatar) {
    return `<img class="${className}" src="${escapeHtml(character.avatar)}" alt="${escapeHtml(character.name)}" />`;
  }
  return `<div class="${className} avatar-fallback">${escapeHtml(character.name.slice(0, 1).toUpperCase())}</div>`;
}

function emptyState(icon: string, title: string, body: string): string {
  return `<div class="empty-state"><span>${icon}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
}

export class AnicontrollerApp {
  private route: Route = 'home';
  private busy = false;
  private currentAnimationSource = '';
  private currentAnimationPrompt = 'Slow cinematic zoom, gentle breathing and subtle movement';
  private activeVideoJobId?: string;
  private stopPreview?: () => void;
  private outputUrl?: string;

  constructor(private readonly root: HTMLElement) {}

  start(): void {
    const requested = location.hash.replace('#/', '') as Route;
    if (['home', 'characters', 'chat', 'animate', 'episodes', 'models', 'settings'].includes(requested)) {
      this.route = requested;
    }
    addEventListener('hashchange', () => {
      const next = location.hash.replace('#/', '') as Route;
      if (next) this.navigate(next, false);
    });
    store.subscribe(() => this.render());
    this.render();
  }

  private navigate(route: Route, updateHash = true): void {
    this.stopPreview?.();
    this.stopPreview = undefined;
    this.route = route;
    if (updateHash) history.replaceState(null, '', `#/${route}`);
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="app-shell">
        ${this.header()}
        <main class="page page-${this.route}">${this.page()}</main>
        ${this.bottomNav()}
      </div>
      <div id="toast-region" class="toast-region" aria-live="polite"></div>
    `;
    this.bindGlobal();
    this.bindPage();
  }

  private header(): string {
    const titles: Record<Route, [string, string]> = {
      home: ['Studio', 'Private creation on your phone'],
      characters: ['Characters', 'Build personalities and appearances'],
      chat: ['Character Chat', 'Local conversations and scene requests'],
      animate: ['Image to Video', '480p local quick animation'],
      episodes: ['Episode Studio', 'Plan scenes and complete stories'],
      models: ['Local Models', 'Manage offline AI components'],
      settings: ['Settings', 'Privacy, performance and defaults'],
    };
    const [title, subtitle] = titles[this.route];
    return `
      <header class="topbar">
        <div class="brand-mark">A</div>
        <div class="topbar-copy"><h1>${title}</h1><p>${subtitle}</p></div>
        <button class="icon-button" data-route="models" aria-label="Local model status">
          <span class="status-dot status-warning"></span><span class="icon-cpu">AI</span>
        </button>
      </header>
    `;
  }

  private page(): string {
    switch (this.route) {
      case 'home':
        return this.homePage();
      case 'characters':
        return this.charactersPage();
      case 'chat':
        return this.chatPage();
      case 'animate':
        return this.animatePage();
      case 'episodes':
        return this.episodesPage();
      case 'models':
        return this.modelsPage();
      case 'settings':
        return this.settingsPage();
    }
  }

  private homePage(): string {
    const state = store.get();
    const recent = state.videoJobs.slice(0, 3);
    return `
      <section class="hero-card">
        <div class="eyebrow"><span class="status-dot status-local"></span> Offline-first workspace</div>
        <h2>Bring a character<br/><span>to life.</span></h2>
        <p>Create a personality, chat privately and turn any image into a short animated scene.</p>
        <div class="hero-actions">
          <button class="primary-button" data-route="characters">Create character</button>
          <button class="secondary-button" data-route="animate">Animate image</button>
        </div>
        <div class="hero-orb orb-one"></div><div class="hero-orb orb-two"></div>
      </section>

      <section class="stat-grid">
        <article><strong>${state.characters.length}</strong><span>Characters</span></article>
        <article><strong>${state.messages.length}</strong><span>Messages</span></article>
        <article><strong>${state.videoJobs.length}</strong><span>Clips</span></article>
      </section>

      <section class="section-block">
        <div class="section-title"><div><h2>Creation modes</h2><p>Choose where to begin</p></div></div>
        <div class="mode-grid">
          <button class="mode-card violet" data-route="chat"><span class="mode-icon">✦</span><div><h3>Character Chat</h3><p>Talk, roleplay and request scenes.</p></div><b>›</b></button>
          <button class="mode-card cyan" data-route="animate"><span class="mode-icon">▶</span><div><h3>Image to Video</h3><p>Animate anime or normal images.</p></div><b>›</b></button>
          <button class="mode-card amber" data-route="episodes"><span class="mode-icon">▤</span><div><h3>Episode Studio</h3><p>Plan characters, scenes and episodes.</p></div><b>›</b></button>
        </div>
      </section>

      <section class="section-block">
        <div class="section-title"><div><h2>Recent renders</h2><p>Stored privately on this device</p></div><button data-route="animate">Open studio</button></div>
        <div class="recent-list">
          ${recent.length ? recent.map((job) => this.videoJobRow(job)).join('') : emptyState('◫', 'No clips yet', 'Your rendered clips will appear here.')}
        </div>
      </section>
    `;
  }

  private charactersPage(): string {
    const state = store.get();
    return `
      <section class="section-block flush-top">
        <div class="section-title"><div><h2>Your cast</h2><p>${state.characters.length} stored locally</p></div><button class="primary-small" id="new-character">＋ New</button></div>
        <div class="character-grid">
          ${state.characters
            .map(
              (character) => `
              <article class="character-card ${state.selectedCharacterId === character.id ? 'selected' : ''}" data-character="${character.id}">
                <div class="character-portrait">${avatar(character, 'portrait-image')}<span class="style-pill">${character.visualStyle}</span></div>
                <div class="character-info"><h3>${escapeHtml(character.name)}</h3><p>${escapeHtml(character.persona)}</p></div>
                <div class="character-actions">
                  <button data-chat-character="${character.id}">Chat</button>
                  <button data-animate-character="${character.id}" ${character.avatar ? '' : 'disabled'}>Animate</button>
                </div>
              </article>`,
            )
            .join('')}
        </div>
      </section>
      <section class="editor-card" id="character-editor">
        <div class="section-title"><div><h2>Create a character</h2><p>Everything stays on this phone</p></div></div>
        <form id="character-form" class="form-stack">
          <label class="image-picker" for="character-image">
            <span class="image-picker-icon">＋</span><strong>Add character image</strong><small>Anime, illustration or normal photograph</small>
            <input id="character-image" name="image" type="file" accept="image/*" />
          </label>
          <div class="field-grid">
            <label><span>Name</span><input name="name" required maxlength="40" placeholder="Character name" /></label>
            <label><span>Visual style</span><select name="style"><option value="auto">Automatic</option><option value="anime">Anime</option><option value="realistic">Realistic</option></select></label>
          </div>
          <label><span>Personality</span><textarea name="persona" required rows="3" placeholder="Confident, playful, direct, curious..."></textarea></label>
          <label><span>Backstory</span><textarea name="backstory" rows="3" placeholder="Who is this character and what do they know?"></textarea></label>
          <label><span>First message</span><textarea name="greeting" rows="2" placeholder="What should they say when the chat begins?"></textarea></label>
          <button class="primary-button wide" type="submit">Save character</button>
        </form>
      </section>
    `;
  }

  private chatPage(): string {
    const state = store.get();
    const character = state.characters.find((item) => item.id === state.selectedCharacterId) ?? state.characters[0];
    if (!character) return emptyState('◇', 'Create a character first', 'A character is required before starting a chat.');
    const messages = state.messages.filter((message) => message.characterId === character.id);
    return `
      <section class="chat-character-bar">
        ${avatar(character)}
        <div><strong>${escapeHtml(character.name)}</strong><span><i></i> Local character</span></div>
        <select id="chat-character-select" aria-label="Choose character">
          ${state.characters.map((item) => `<option value="${item.id}" ${item.id === character.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
        </select>
      </section>
      <section class="chat-notice"><span>⌁</span><p><strong>${webLlm.isReady() ? 'Local GGUF model active' : 'Demo conversation engine'}</strong> ${webLlm.isReady() ? 'Replies are generated locally on this device.' : 'Import and load a GGUF model under Local Models. Video commands already work.'}</p>${webLlm.isReady() ? '' : '<button data-route="models">Models</button>'}</section>
      <section class="message-list" id="message-list">
        ${messages
          .map(
            (message) => `
            <article class="message ${message.role}">
              ${message.role === 'character' ? avatar(character, 'message-avatar') : ''}
              <div class="message-content">
                <p>${escapeHtml(message.text)}</p>
                ${
                  message.videoJobId
                    ? `<button class="video-request-card" data-open-job="${message.videoJobId}"><span>▶</span><div><strong>Animation ready to review</strong><small>Open the 480p render setup</small></div><b>›</b></button>`
                    : ''
                }
                <time>${timeLabel(message.createdAt)}</time>
              </div>
            </article>`,
          )
          .join('')}
        ${this.busy ? `<article class="message character"><div class="message-avatar avatar-fallback">${escapeHtml(character.name[0] ?? 'A')}</div><div class="typing"><i></i><i></i><i></i></div></article>` : ''}
      </section>
      <section class="prompt-suggestion-row">
        <button data-suggestion="/video Slowly turn toward the camera, smile and let the wind move your hair">Animate character</button>
        <button data-suggestion="Tell me about yourself">Ask about them</button>
      </section>
      <form class="chat-composer" id="chat-form">
        <textarea id="chat-input" rows="1" maxlength="1200" placeholder="Message ${escapeHtml(character.name)} or use /video..."></textarea>
        <button type="submit" aria-label="Send" ${this.busy ? 'disabled' : ''}>➤</button>
      </form>
    `;
  }

  private animatePage(): string {
    const state = store.get();
    const activeJob = this.activeVideoJobId ? state.videoJobs.find((job) => job.id === this.activeVideoJobId) : undefined;
    const source = this.currentAnimationSource || activeJob?.sourceImage || '';
    const prompt = activeJob?.prompt || this.currentAnimationPrompt;
    const plan = parseMotionPrompt(prompt);
    return `
      <section class="animate-stage">
        <div class="canvas-wrap ${source ? 'has-image' : ''}">
          <canvas id="motion-canvas" aria-label="Animation preview"></canvas>
          ${
            source
              ? `<img id="source-placeholder" src="${escapeHtml(source)}" alt="Selected source" />`
              : `<label class="stage-empty" for="animation-image"><span>＋</span><strong>Select an image</strong><small>Anime, photo, pet, landscape or product</small></label>`
          }
          <input id="animation-image" type="file" accept="image/*" />
          ${source ? `<label class="replace-image" for="animation-image">Replace image</label>` : ''}
        </div>
      </section>
      <section class="editor-card animate-controls">
        <div class="mode-switch" role="group" aria-label="Animation mode">
          <button class="active" data-animation-mode="quick">Quick Animate <small>Available</small></button>
          <button data-animation-mode="ai">AI Animate <small>Runtime pending</small></button>
        </div>
        <label><span>What should the image do?</span><textarea id="animation-prompt" rows="4" placeholder="Describe the movement, expression, camera and atmosphere...">${escapeHtml(prompt)}</textarea></label>
        <div class="motion-tags" id="motion-tags">${plan.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join('')}</div>
        <div class="field-grid three">
          <label><span>Duration</span><select id="animation-duration"><option value="3" ${activeJob?.duration === 3 ? 'selected' : ''}>3 seconds</option><option value="4" ${activeJob?.duration === 4 ? 'selected' : ''}>4 seconds</option><option value="5" ${activeJob?.duration === 5 ? 'selected' : ''}>5 seconds</option></select></label>
          <label><span>Style</span><select id="animation-style"><option value="auto">Automatic</option><option value="anime">Anime</option><option value="realistic">Realistic</option></select></label>
          <label><span>Output</span><select disabled><option>480p · 12 FPS</option></select></label>
        </div>
        <div class="render-progress hidden" id="render-progress"><div><span id="render-progress-bar"></span></div><p id="render-progress-text">Preparing local render…</p></div>
        <div class="button-row">
          <button class="secondary-button" id="preview-animation" ${source ? '' : 'disabled'}>Preview</button>
          <button class="primary-button" id="render-animation" ${source ? '' : 'disabled'}>Render clip</button>
        </div>
        <div id="render-result"></div>
      </section>
      <section class="info-card"><span>⌁</span><div><strong>Quick Animate is functional now</strong><p>It creates a real 480p MP4 when hardware WebCodecs are available, with WebM fallback. Generative AI keyframes require the native model runtime.</p></div></section>
    `;
  }

  private episodesPage(): string {
    const state = store.get();
    return `
      <section class="hero-card episode-hero"><div class="eyebrow">Long-form workspace</div><h2>Build complete<br/><span>episodes.</span></h2><p>Keep character identities, scenes and prompts organised before generating individual clips.</p><div class="hero-orb orb-one"></div></section>
      <section class="editor-card">
        <div class="section-title"><div><h2>New episode project</h2><p>Create the production outline</p></div></div>
        <form id="episode-form" class="form-stack">
          <label><span>Episode title</span><input name="title" required placeholder="The first awakening" /></label>
          <label><span>Story concept</span><textarea name="concept" required rows="4" placeholder="Describe the episode, conflict and intended ending..."></textarea></label>
          <div class="field-grid">
            <label><span>Target length</span><select name="minutes"><option value="3">3 minutes</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="20">20 minutes</option></select></label>
            <label><span>Style</span><select name="style"><option value="anime">Anime</option><option value="realistic">Realistic</option><option value="auto">Automatic</option></select></label>
          </div>
          <fieldset><legend>Characters</legend><div class="check-grid">${state.characters.map((character) => `<label><input type="checkbox" name="characters" value="${character.id}" /><span>${avatar(character, 'mini-avatar')} ${escapeHtml(character.name)}</span></label>`).join('')}</div></fieldset>
          <button class="primary-button wide" type="submit">Create project</button>
        </form>
      </section>
      <section class="section-block">
        <div class="section-title"><div><h2>Your episodes</h2><p>${state.episodes.length} local projects</p></div></div>
        <div class="episode-list">${state.episodes.length ? state.episodes.map((episode) => `<article><span>▤</span><div><h3>${escapeHtml(episode.title)}</h3><p>${escapeHtml(episode.concept)}</p><small>${episode.targetMinutes} min · ${episode.style} · ${episode.characterIds.length} characters</small></div><b>›</b></article>`).join('') : emptyState('▤', 'No episode projects', 'Create the first outline above.')}</div>
      </section>
    `;
  }

  private modelsPage(): string {
    const model = webLlm.getInfo();
    const ready = webLlm.isReady();
    return `
      <section class="model-summary">
        <div class="model-ring"><span>${ready ? '1' : model ? '◐' : '0'}</span><small>${ready ? 'active' : model ? 'stored' : 'installed'}</small></div>
        <div><h2>Local AI runtime</h2><p>${ready ? 'Your character model is loaded and ready for private chat.' : model ? `${escapeHtml(model.name)} is stored locally and can be loaded when you want to chat.` : 'Import your own GGUF model. The model remains private and is not bundled into the APK.'}</p></div>
      </section>
      <section class="editor-card model-import-card">
        <div class="section-title"><div><h2>Character chat model</h2><p>Recommended: Qwen3 1.7B Q4 GGUF, smaller than 2 GB</p></div></div>
        <label class="image-picker model-picker" for="gguf-model">
          <span class="image-picker-icon">＋</span><strong>${model ? 'Replace GGUF model' : 'Import GGUF model'}</strong><small>The file is copied into private app storage when supported</small>
          <input id="gguf-model" type="file" accept=".gguf,application/octet-stream" />
        </label>
        <div class="render-progress hidden" id="model-progress"><div><span id="model-progress-bar"></span></div><p id="model-progress-text">Preparing…</p></div>
        <div class="button-row model-buttons">
          <button class="secondary-button" id="remove-model" ${model ? '' : 'disabled'}>Remove</button>
          <button class="primary-button" id="load-model" ${model && !ready ? '' : 'disabled'}>${ready ? 'Model loaded' : 'Load for chat'}</button>
        </div>
      </section>
      <section class="section-block">
        <div class="section-title"><div><h2>Planned components</h2><p>Loaded one at a time to protect 8GB RAM devices</p></div></div>
        <div class="model-list">
          <article><span class="model-icon violet">LLM</span><div><h3>Character & Motion Planner</h3><p>Importable quantised GGUF · wllama/llama.cpp</p></div><em>${ready ? 'Active' : model ? 'Stored' : 'Not installed'}</em></article>
          <article><span class="model-icon cyan">STT</span><div><h3>Offline Speech Recognition</h3><p>Compact speech-to-text model · sherpa-onnx</p></div><em>Runtime pending</em></article>
          <article><span class="model-icon amber">TTS</span><div><h3>Local Character Voice</h3><p>Kokoro/Piper compatible voice engine</p></div><em>Runtime pending</em></article>
          <article><span class="model-icon rose">VID</span><div><h3>AI Keyframe Engine</h3><p>Phone-optimised image animation model</p></div><em>Research stage</em></article>
        </div>
      </section>
      <section class="info-card"><span>!</span><div><strong>Local model control</strong><p>Imported files are loaded directly on the phone. There is no remote fallback, message moderation service or API account in this path.</p></div></section>
    `;
  }

  private settingsPage(): string {
    const settings = store.get().settings;
    return `
      <section class="settings-list">
        <article><div><h3>Speak character replies</h3><p>Use the device voice engine when available.</p></div><label class="switch"><input id="setting-auto-speak" type="checkbox" ${settings.autoSpeak ? 'checked' : ''}/><span></span></label></article>
        <article><div><h3>Natural video requests</h3><p>Recognise “show me…” in addition to /video.</p></div><label class="switch"><input id="setting-natural-video" type="checkbox" ${settings.allowNaturalVideoRequests ? 'checked' : ''}/><span></span></label></article>
        <article class="vertical"><div><h3>Thermal limit</h3><p>Pause heavy native generation at the configured temperature.</p></div><label><input id="setting-thermal" type="range" min="39" max="47" value="${settings.thermalLimitC}"/><strong id="thermal-value">${settings.thermalLimitC}°C</strong></label></article>
      </section>
      <section class="privacy-card"><span>⌾</span><div><h3>Local by design</h3><p>Character profiles, chat history and project metadata are stored in this app’s private local storage. The native AI bridge will not require a server account.</p></div></section>
      <section class="danger-card"><div><h3>Reset local workspace</h3><p>Remove characters, messages, prompts and episode projects from this installation.</p></div><button id="reset-app">Reset</button></section>
    `;
  }

  private videoJobRow(job: VideoJob): string {
    return `<button class="recent-row" data-open-job="${job.id}"><span class="recent-thumb">▶</span><div><strong>${escapeHtml(job.prompt)}</strong><small>${job.duration}s · ${job.mode} · ${job.status}</small></div><b>›</b></button>`;
  }

  private bottomNav(): string {
    const items: Array<[Route, string, string]> = [
      ['home', '⌂', 'Home'],
      ['characters', '◇', 'Cast'],
      ['chat', '◉', 'Chat'],
      ['animate', '▶', 'Animate'],
      ['settings', '•••', 'More'],
    ];
    return `<nav class="bottom-nav">${items.map(([route, icon, label]) => `<button data-route="${route}" class="${this.route === route || (route === 'settings' && this.route === 'models') ? 'active' : ''}"><span>${icon}</span><small>${label}</small></button>`).join('')}</nav>`;
  }

  private bindGlobal(): void {
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((element) => {
      element.addEventListener('click', () => this.navigate(element.dataset.route as Route));
    });
    this.root.querySelectorAll<HTMLElement>('[data-open-job]').forEach((element) => {
      element.addEventListener('click', () => {
        const id = element.dataset.openJob;
        const job = store.get().videoJobs.find((item) => item.id === id);
        if (!job) return;
        this.activeVideoJobId = job.id;
        this.currentAnimationSource = job.sourceImage;
        this.currentAnimationPrompt = job.prompt;
        this.navigate('animate');
      });
    });
  }

  private bindPage(): void {
    if (this.route === 'characters') this.bindCharacters();
    if (this.route === 'chat') this.bindChat();
    if (this.route === 'animate') this.bindAnimate();
    if (this.route === 'episodes') this.bindEpisodes();
    if (this.route === 'models') this.bindModels();
    if (this.route === 'settings') this.bindSettings();
  }

  private bindCharacters(): void {
    this.root.querySelector('#new-character')?.addEventListener('click', () => {
      this.root.querySelector('#character-editor')?.scrollIntoView({ behavior: 'smooth' });
    });
    this.root.querySelectorAll<HTMLElement>('[data-chat-character]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        store.selectCharacter(button.dataset.chatCharacter!);
        this.navigate('chat');
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-animate-character]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const character = store.get().characters.find((item) => item.id === button.dataset.animateCharacter);
        if (!character?.avatar) return;
        store.selectCharacter(character.id);
        this.currentAnimationSource = character.avatar;
        this.activeVideoJobId = undefined;
        this.navigate('animate');
      });
    });
    const form = this.root.querySelector<HTMLFormElement>('#character-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const file = data.get('image');
      let image = '';
      if (file instanceof File && file.size) {
        try {
          image = await resizeImage(file);
        } catch (error) {
          this.toast(error instanceof Error ? error.message : 'Image processing failed.', 'error');
          return;
        }
      }
      store.saveCharacter({
        name: String(data.get('name') ?? '').trim(),
        avatar: image,
        visualStyle: String(data.get('style') ?? 'auto') as VisualStyle,
        persona: String(data.get('persona') ?? '').trim(),
        backstory: String(data.get('backstory') ?? '').trim(),
        greeting: String(data.get('greeting') ?? '').trim() || 'I’m here. What should we create together?',
        voice: 'Local voice 1',
        memory: '',
      });
      this.toast('Character saved locally.', 'success');
    });
  }

  private bindChat(): void {
    const state = store.get();
    const character = state.characters.find((item) => item.id === state.selectedCharacterId) ?? state.characters[0];
    if (!character) return;
    requestAnimationFrame(() => {
      const list = this.root.querySelector('#message-list');
      list?.scrollTo({ top: list.scrollHeight });
    });
    this.root.querySelector<HTMLSelectElement>('#chat-character-select')?.addEventListener('change', (event) => {
      store.selectCharacter((event.target as HTMLSelectElement).value);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-suggestion]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = this.root.querySelector<HTMLTextAreaElement>('#chat-input');
        if (input) {
          input.value = button.dataset.suggestion ?? '';
          input.focus();
        }
      });
    });
    const form = this.root.querySelector<HTMLFormElement>('#chat-form');
    const input = this.root.querySelector<HTMLTextAreaElement>('#chat-input');
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input?.value.trim() ?? '';
      if (!text || this.busy) return;
      store.addMessage({ characterId: character.id, role: 'user', text });
      this.busy = true;
      this.render();
      const latest = store.get();
      const messages = latest.messages.filter((message) => message.characterId === character.id);
      try {
        const reply = await getCharacterReply(character, messages, text, latest.settings.allowNaturalVideoRequests);
        let videoJobId: string | undefined;
        if (reply.videoPrompt) {
          const job = store.addVideoJob({
            characterId: character.id,
            sourceImage: character.avatar,
            prompt: reply.videoPrompt,
            duration: latest.settings.defaultDuration,
            style: character.visualStyle,
            mode: 'quick',
          });
          videoJobId = job.id;
        }
        store.addMessage({ characterId: character.id, role: 'character', text: reply.text, videoJobId });
        if (store.get().settings.autoSpeak) this.speak(reply.text);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The local character model failed to respond.';
        store.addMessage({ characterId: character.id, role: 'system', text: message });
        this.toast(message, 'error');
      } finally {
        this.busy = false;
        this.render();
      }
    });
  }

  private bindAnimate(): void {
    const imageInput = this.root.querySelector<HTMLInputElement>('#animation-image');
    imageInput?.addEventListener('change', async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      try {
        this.currentAnimationSource = await resizeImage(file, 1280);
        this.activeVideoJobId = undefined;
        this.render();
      } catch (error) {
        this.toast(error instanceof Error ? error.message : 'Image processing failed.', 'error');
      }
    });
    const prompt = this.root.querySelector<HTMLTextAreaElement>('#animation-prompt');
    prompt?.addEventListener('input', () => {
      this.currentAnimationPrompt = prompt.value;
      const tags = this.root.querySelector('#motion-tags');
      if (tags) tags.innerHTML = parseMotionPrompt(prompt.value).actions.map((action) => `<span>${escapeHtml(action)}</span>`).join('');
    });
    this.root.querySelector('#preview-animation')?.addEventListener('click', async () => {
      const canvas = this.root.querySelector<HTMLCanvasElement>('#motion-canvas');
      const placeholder = this.root.querySelector<HTMLElement>('#source-placeholder');
      const duration = Number(this.root.querySelector<HTMLSelectElement>('#animation-duration')?.value ?? 3);
      if (!canvas || !this.currentAnimationSource && !this.activeVideoJobId) return;
      const source = this.currentAnimationSource || store.get().videoJobs.find((job) => job.id === this.activeVideoJobId)?.sourceImage || '';
      if (!source) return;
      placeholder?.classList.add('hidden');
      canvas.classList.add('visible');
      this.stopPreview?.();
      try {
        this.stopPreview = await startPreview(canvas, source, prompt?.value ?? '', duration);
      } catch (error) {
        this.toast(error instanceof Error ? error.message : 'Preview failed.', 'error');
      }
    });
    this.root.querySelector('#render-animation')?.addEventListener('click', async () => {
      const source = this.currentAnimationSource || store.get().videoJobs.find((job) => job.id === this.activeVideoJobId)?.sourceImage || '';
      const duration = Number(this.root.querySelector<HTMLSelectElement>('#animation-duration')?.value ?? 3) as 3 | 4 | 5;
      const style = (this.root.querySelector<HTMLSelectElement>('#animation-style')?.value ?? 'auto') as VisualStyle;
      const text = prompt?.value.trim() ?? '';
      if (!source || !text) return;
      let job = this.activeVideoJobId ? store.get().videoJobs.find((item) => item.id === this.activeVideoJobId) : undefined;
      if (!job) {
        job = store.addVideoJob({ sourceImage: source, prompt: text, duration, style, mode: 'quick' });
        this.activeVideoJobId = job.id;
      } else {
        store.updateVideoJob(job.id, { sourceImage: source, prompt: text, duration, style, mode: 'quick' });
      }
      const progress = this.root.querySelector<HTMLElement>('#render-progress');
      const progressBar = this.root.querySelector<HTMLElement>('#render-progress-bar');
      const progressText = this.root.querySelector<HTMLElement>('#render-progress-text');
      progress?.classList.remove('hidden');
      store.updateVideoJob(job.id, { status: 'rendering', progress: 0 });
      try {
        await webLlm.unload();
        const result = await renderQuickClip({
          sourceImage: source,
          prompt: text,
          duration,
          onProgress: (value) => {
            if (progressBar) progressBar.style.width = `${value}%`;
            if (progressText) progressText.textContent = `Rendering locally… ${value}%`;
          },
        });
        if (this.outputUrl) URL.revokeObjectURL(this.outputUrl);
        this.outputUrl = URL.createObjectURL(result.blob);
        store.updateVideoJob(job.id, { status: 'complete', progress: 100 });
        const resultNode = this.root.querySelector<HTMLElement>('#render-result');
        if (resultNode) {
          resultNode.innerHTML = `<div class="result-card"><video src="${this.outputUrl}" controls loop playsinline></video><a class="primary-button wide" href="${this.outputUrl}" download="anicontroller-${Date.now()}.${result.extension}">Save ${result.extension.toUpperCase()}</a></div>`;
        }
        if (progressText) progressText.textContent = 'Render complete';
        this.toast('Clip rendered on this device.', 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Local rendering failed.';
        store.updateVideoJob(job.id, { status: 'failed', error: message });
        if (progressText) progressText.textContent = message;
        this.toast(message, 'error');
      }
    });
  }

  private bindModels(): void {
    const input = this.root.querySelector<HTMLInputElement>('#gguf-model');
    const progress = this.root.querySelector<HTMLElement>('#model-progress');
    const progressBar = this.root.querySelector<HTMLElement>('#model-progress-bar');
    const progressText = this.root.querySelector<HTMLElement>('#model-progress-text');
    const updateProgress = (value: number, status: string) => {
      progress?.classList.remove('hidden');
      if (progressBar) progressBar.style.width = `${value}%`;
      if (progressText) progressText.textContent = status;
    };
    input?.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await webLlm.importModel(file, updateProgress);
        this.toast('GGUF model imported locally.', 'success');
        globalThis.setTimeout(() => this.render(), 250);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Model import failed.';
        updateProgress(0, message);
        this.toast(message, 'error');
      }
    });
    this.root.querySelector('#load-model')?.addEventListener('click', async () => {
      try {
        await webLlm.load(updateProgress);
        this.toast('Local character model loaded.', 'success');
        this.render();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The local model could not be loaded.';
        updateProgress(0, message);
        this.toast(message, 'error');
      }
    });
    this.root.querySelector('#remove-model')?.addEventListener('click', async () => {
      if (!confirm('Remove the local GGUF model from Anicontroller?')) return;
      await webLlm.remove();
      this.toast('Local model removed.', 'success');
      this.render();
    });
  }

  private bindEpisodes(): void {
    const form = this.root.querySelector<HTMLFormElement>('#episode-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      store.addEpisode({
        title: String(data.get('title') ?? '').trim(),
        concept: String(data.get('concept') ?? '').trim(),
        targetMinutes: Number(data.get('minutes') ?? 3),
        style: String(data.get('style') ?? 'anime') as VisualStyle,
        characterIds: data.getAll('characters').map(String),
      });
      this.toast('Episode project created.', 'success');
    });
  }

  private bindSettings(): void {
    this.root.querySelector<HTMLInputElement>('#setting-auto-speak')?.addEventListener('change', (event) => {
      store.updateSettings({ autoSpeak: (event.target as HTMLInputElement).checked });
    });
    this.root.querySelector<HTMLInputElement>('#setting-natural-video')?.addEventListener('change', (event) => {
      store.updateSettings({ allowNaturalVideoRequests: (event.target as HTMLInputElement).checked });
    });
    this.root.querySelector<HTMLInputElement>('#setting-thermal')?.addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      const output = this.root.querySelector('#thermal-value');
      if (output) output.textContent = `${value}°C`;
      store.updateSettings({ thermalLimitC: value });
    });
    this.root.querySelector('#reset-app')?.addEventListener('click', () => {
      if (confirm('Remove all local Anicontroller data from this installation?')) store.reset();
    });
  }

  private speak(text: string): void {
    if (!('speechSynthesis' in globalThis)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  private toast(message: string, type: 'success' | 'error'): void {
    const region = this.root.querySelector('#toast-region') ?? document.querySelector('#toast-region');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    region.append(toast);
    globalThis.setTimeout(() => toast.remove(), 3200);
  }
}
