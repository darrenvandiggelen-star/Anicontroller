import type {
  AppSettings,
  AppState,
  Character,
  ChatMessage,
  EpisodeProject,
  VideoJob,
} from './types';

const STORAGE_KEY = 'anicontroller.state.v1';

const DEFAULT_SETTINGS: AppSettings = {
  thermalLimitC: 43,
  autoSpeak: false,
  allowNaturalVideoRequests: true,
  defaultDuration: 3,
  defaultStyle: 'auto',
};

function uid(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function demoCharacter(): Character {
  const now = Date.now();
  return {
    id: uid('char'),
    name: 'Nova',
    avatar: '',
    visualStyle: 'anime',
    persona: 'Confident, playful, curious and expressive. Speaks naturally and stays in character.',
    backstory: 'A wandering dimensional storyteller who turns conversations into animated scenes.',
    greeting: 'Hey, I’m Nova. Tell me what kind of scene you want us to create.',
    voice: 'Local voice 1',
    memory: '',
    createdAt: now,
    updatedAt: now,
  };
}

function initialState(): AppState {
  const character = demoCharacter();
  return {
    version: 1,
    characters: [character],
    messages: [
      {
        id: uid('msg'),
        characterId: character.id,
        role: 'character',
        text: character.greeting,
        createdAt: Date.now(),
      },
    ],
    videoJobs: [],
    episodes: [],
    selectedCharacterId: character.id,
    settings: DEFAULT_SETTINGS,
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw) as Partial<AppState>;
    if (saved.version !== 1 || !Array.isArray(saved.characters)) return initialState();
    return {
      ...initialState(),
      ...saved,
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    };
  } catch {
    return initialState();
  }
}

class AppStore {
  private state = loadState();
  private listeners = new Set<() => void>();

  get(): AppState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: AppState): void {
    this.state = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.listeners.forEach((listener) => listener());
  }

  selectCharacter(id: string): void {
    this.commit({ ...this.state, selectedCharacterId: id });
  }

  saveCharacter(input: Omit<Character, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Character {
    const now = Date.now();
    const existing = input.id ? this.state.characters.find((item) => item.id === input.id) : undefined;
    const character: Character = {
      ...input,
      id: existing?.id ?? uid('char'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const characters = existing
      ? this.state.characters.map((item) => (item.id === character.id ? character : item))
      : [...this.state.characters, character];
    let messages = this.state.messages;
    if (!existing && character.greeting.trim()) {
      messages = [
        ...messages,
        {
          id: uid('msg'),
          characterId: character.id,
          role: 'character',
          text: character.greeting,
          createdAt: now,
        },
      ];
    }
    this.commit({ ...this.state, characters, messages, selectedCharacterId: character.id });
    return character;
  }

  addMessage(message: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
    const saved: ChatMessage = { ...message, id: uid('msg'), createdAt: Date.now() };
    this.commit({ ...this.state, messages: [...this.state.messages, saved] });
    return saved;
  }

  addVideoJob(input: Omit<VideoJob, 'id' | 'createdAt' | 'status' | 'progress'>): VideoJob {
    const job: VideoJob = {
      ...input,
      id: uid('video'),
      createdAt: Date.now(),
      status: 'draft',
      progress: 0,
    };
    this.commit({ ...this.state, videoJobs: [job, ...this.state.videoJobs] });
    return job;
  }

  updateVideoJob(id: string, patch: Partial<VideoJob>): void {
    const videoJobs = this.state.videoJobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
    this.commit({ ...this.state, videoJobs });
  }

  addEpisode(input: Omit<EpisodeProject, 'id' | 'createdAt'>): EpisodeProject {
    const episode: EpisodeProject = { ...input, id: uid('episode'), createdAt: Date.now() };
    this.commit({ ...this.state, episodes: [episode, ...this.state.episodes] });
    return episode;
  }

  updateSettings(patch: Partial<AppSettings>): void {
    this.commit({ ...this.state, settings: { ...this.state.settings, ...patch } });
  }

  reset(): void {
    this.commit(initialState());
  }
}

export const store = new AppStore();

export async function resizeImage(file: File, maxDimension = 960): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable on this device.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}
