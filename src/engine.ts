import type { Character, ChatMessage, MotionPlan } from './types';
import { webLlm } from './web-llm';

export interface CharacterReply {
  text: string;
  emotion: 'neutral' | 'happy' | 'curious' | 'excited' | 'serious';
  videoPrompt?: string;
  engine: 'native' | 'demo';
}

interface NativeAiPlugin {
  isReady(): Promise<{ ready: boolean }>;
  characterReply(options: {
    character: Character;
    messages: ChatMessage[];
    input: string;
  }): Promise<CharacterReply>;
}

function nativePlugin(): NativeAiPlugin | undefined {
  const capacitor = (globalThis as unknown as {
    Capacitor?: { Plugins?: { LocalAi?: NativeAiPlugin } };
  }).Capacitor;
  return capacitor?.Plugins?.LocalAi;
}

export function extractVideoPrompt(input: string, naturalRequests = true): string | undefined {
  const trimmed = input.trim();
  const slash = trimmed.match(/^\/video\s+(.+)/is);
  if (slash?.[1]) return slash[1].trim();
  if (!naturalRequests) return undefined;
  const natural = trimmed.match(
    /^(?:show me|make|create|generate|animate)(?:\s+(?:a|an|the|this|your|me))*\s*(?:video|clip|image|picture|yourself)?\s*(?:of|where|doing|so that|to)?\s*(.+)$/is,
  );
  if (!natural?.[1]) return undefined;
  const prompt = natural[1].trim();
  return prompt.length >= 4 ? prompt : undefined;
}

export function parseMotionPrompt(input: string): MotionPlan {
  const prompt = input.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => prompt.includes(term));
  let panX = 0;
  let panY = 0;
  if (has('pan left', 'move left', 'walk left', 'look left')) panX = -0.08;
  if (has('pan right', 'move right', 'walk right', 'look right')) panX = 0.08;
  if (has('rise', 'move up', 'look up')) panY = -0.06;
  if (has('drop', 'move down', 'look down')) panY = 0.06;

  const actions: string[] = [];
  if (has('zoom', 'closer', 'push in')) actions.push('Camera zoom');
  if (panX !== 0 || panY !== 0) actions.push('Camera pan');
  if (has('shake', 'impact', 'explosion', 'fight', 'attack')) actions.push('Camera shake');
  if (has('wind', 'hair', 'sway', 'breeze')) actions.push('Gentle sway');
  if (has('talk', 'speak', 'say', 'sing')) actions.push('Talking motion');
  if (has('blink')) actions.push('Blink cue');
  if (has('smile')) actions.push('Smile cue');
  if (!actions.length) actions.push('Subtle cinematic motion');

  return {
    panX,
    panY,
    zoom: has('zoom out', 'pull back') ? -0.06 : has('zoom', 'closer', 'push in') ? 0.1 : 0.045,
    rotation: has('spin', 'rotate') ? 0.07 : has('turn', 'look') ? 0.025 : 0.008,
    shake: has('shake', 'impact', 'explosion', 'fight', 'attack') ? 0.018 : 0,
    sway: has('wind', 'hair', 'sway', 'breeze', 'dance') ? 0.018 : 0.006,
    pulse: has('talk', 'speak', 'say', 'sing', 'breathe') ? 0.018 : 0.006,
    speed: has('fast', 'quickly', 'sudden') ? 1.5 : has('slow', 'slowly', 'gentle') ? 0.65 : 1,
    actions,
  };
}

const fallbackLines = [
  'I’m listening. Keep going—I want to see where you take this.',
  'That gives me an idea. Describe the scene in a little more detail.',
  'I can work with that. What should happen next?',
  'Interesting. I’ll remember that for our next scene.',
];

async function demoReply(character: Character, input: string, videoPrompt?: string): Promise<CharacterReply> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 360));
  if (videoPrompt) {
    return {
      text: `I’ve prepared that animation prompt: “${videoPrompt}”. Review it, then start the local render.`,
      emotion: 'excited',
      videoPrompt,
      engine: 'demo',
    };
  }
  const index = Math.abs(input.length + character.name.length) % fallbackLines.length;
  return {
    text: fallbackLines[index] ?? fallbackLines[0]!,
    emotion: input.includes('?') ? 'curious' : 'happy',
    engine: 'demo',
  };
}

export async function getCharacterReply(
  character: Character,
  messages: ChatMessage[],
  input: string,
  naturalVideoRequests = true,
): Promise<CharacterReply> {
  const videoPrompt = extractVideoPrompt(input, naturalVideoRequests);
  if (!videoPrompt && webLlm.isReady()) {
    const text = await webLlm.reply(character, messages, input);
    return {
      text,
      emotion: input.includes('?') ? 'curious' : 'happy',
      engine: 'native',
    };
  }
  const plugin = nativePlugin();
  if (plugin) {
    try {
      const status = await plugin.isReady();
      if (status.ready) return await plugin.characterReply({ character, messages, input });
    } catch {
      // The web/demo engine remains usable if the native runtime is unavailable.
    }
  }
  return demoReply(character, input, videoPrompt);
}
