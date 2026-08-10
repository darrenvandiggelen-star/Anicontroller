export type Axis = 'x' | 'y' | 'z';

export type DirectorAction =
  | { type: 'bone'; bone: string; axis: Axis; degrees: number }
  | { type: 'expression'; name: string; value: number }
  | { type: 'resetPose' }
  | { type: 'camera'; preset: 'front' | 'close' | 'full' }
  | { type: 'gesture'; name: 'waveLeft' | 'waveRight' };

export interface ParsedDirectorCommand {
  raw: string;
  actions: DirectorAction[];
  summary: string;
}

export interface ChatSettings {
  characterName: string;
  personality: string;
  endpoint: string;
  apiKey: string;
  model: string;
}
