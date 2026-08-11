export type Route = 'home' | 'characters' | 'chat' | 'animate' | 'episodes' | 'models' | 'settings';
export type VisualStyle = 'auto' | 'anime' | 'realistic';
export type MessageRole = 'user' | 'character' | 'system';
export type VideoJobStatus = 'draft' | 'rendering' | 'complete' | 'failed';

export interface Character {
  id: string;
  name: string;
  avatar: string;
  visualStyle: VisualStyle;
  persona: string;
  backstory: string;
  greeting: string;
  voice: string;
  memory: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  characterId: string;
  role: MessageRole;
  text: string;
  createdAt: number;
  videoJobId?: string;
}

export interface VideoJob {
  id: string;
  characterId?: string;
  sourceImage: string;
  prompt: string;
  duration: 3 | 4 | 5;
  style: VisualStyle;
  mode: 'quick' | 'ai';
  status: VideoJobStatus;
  progress: number;
  createdAt: number;
  error?: string;
}

export interface EpisodeProject {
  id: string;
  title: string;
  concept: string;
  style: VisualStyle;
  targetMinutes: number;
  characterIds: string[];
  createdAt: number;
}

export interface AppSettings {
  thermalLimitC: number;
  autoSpeak: boolean;
  allowNaturalVideoRequests: boolean;
  defaultDuration: 3 | 4 | 5;
  defaultStyle: VisualStyle;
}

export interface AppState {
  version: 1;
  characters: Character[];
  messages: ChatMessage[];
  videoJobs: VideoJob[];
  episodes: EpisodeProject[];
  selectedCharacterId?: string;
  settings: AppSettings;
}

export interface MotionPlan {
  panX: number;
  panY: number;
  zoom: number;
  rotation: number;
  shake: number;
  sway: number;
  pulse: number;
  speed: number;
  actions: string[];
}
