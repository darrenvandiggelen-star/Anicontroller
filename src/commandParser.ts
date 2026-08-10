import type { ParsedDirectorCommand, DirectorAction } from './types';

const normalize = (value: string) => value.trim().toLowerCase().replace(/°/g, ' degrees').replace(/\s+/g, ' ');
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const BONE_ALIASES: Record<string, string> = {
  'head': 'head',
  'neck': 'neck',
  'chest': 'chest',
  'upper chest': 'upperChest',
  'hips': 'hips',
  'spine': 'spine',
  'left shoulder': 'leftShoulder',
  'right shoulder': 'rightShoulder',
  'left upper arm': 'leftUpperArm',
  'right upper arm': 'rightUpperArm',
  'left arm': 'leftUpperArm',
  'right arm': 'rightUpperArm',
  'left lower arm': 'leftLowerArm',
  'right lower arm': 'rightLowerArm',
  'left forearm': 'leftLowerArm',
  'right forearm': 'rightLowerArm',
  'left hand': 'leftHand',
  'right hand': 'rightHand',
  'left upper leg': 'leftUpperLeg',
  'right upper leg': 'rightUpperLeg',
  'left thigh': 'leftUpperLeg',
  'right thigh': 'rightUpperLeg',
  'left lower leg': 'leftLowerLeg',
  'right lower leg': 'rightLowerLeg',
  'left shin': 'leftLowerLeg',
  'right shin': 'rightLowerLeg',
  'left foot': 'leftFoot',
  'right foot': 'rightFoot',
};

function findBoneAlias(text: string): string | undefined {
  const keys = Object.keys(BONE_ALIASES).sort((a, b) => b.length - a.length);
  return keys.find((key) => text.includes(key));
}

function numberFrom(text: string, fallback = 20): number {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function expressionValue(text: string): number {
  const n = numberFrom(text, 100);
  return clamp(n > 1 ? n / 100 : n, 0, 1);
}

export function parseDirectorCommand(input: string): ParsedDirectorCommand {
  const text = normalize(input);
  const actions: DirectorAction[] = [];

  if (!text) return { raw: input, actions, summary: 'No command entered.' };

  if (/^(reset|reset pose|neutral pose|t pose)$/.test(text)) {
    actions.push({ type: 'resetPose' });
    return { raw: input, actions, summary: 'Reset pose.' };
  }

  if (text.includes('camera')) {
    const preset = text.includes('close') ? 'close' : text.includes('full') || text.includes('body') ? 'full' : 'front';
    actions.push({ type: 'camera', preset });
    return { raw: input, actions, summary: `Camera: ${preset}.` };
  }

  if (text.includes('wave')) {
    const side = text.includes('left') ? 'waveLeft' : 'waveRight';
    actions.push({ type: 'gesture', name: side });
    return { raw: input, actions, summary: side === 'waveLeft' ? 'Wave left hand.' : 'Wave right hand.' };
  }

  const expressionMap: Array<[RegExp, string]> = [
    [/\b(smile|happy)\b/, 'happy'],
    [/\b(angry|mad)\b/, 'angry'],
    [/\b(sad|unhappy)\b/, 'sad'],
    [/\b(surprised|surprise|shocked)\b/, 'surprised'],
    [/\b(relaxed|calm)\b/, 'relaxed'],
    [/\b(neutral)\b/, 'neutral'],
    [/\bblink\b/, 'blink'],
  ];

  for (const [pattern, name] of expressionMap) {
    if (pattern.test(text) && !text.includes('pose')) {
      const value = expressionValue(text);
      actions.push({ type: 'expression', name, value });
      return { raw: input, actions, summary: `Expression ${name}: ${Math.round(value * 100)}%.` };
    }
  }

  const explicitRotation = text.match(/(?:rotate|set)\s+(.+?)\s+([xyz])(?:\s+axis)?\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/);
  if (explicitRotation) {
    const alias = findBoneAlias(explicitRotation[1]) ?? explicitRotation[1].trim();
    const bone = BONE_ALIASES[alias] ?? alias;
    const axis = explicitRotation[2] as 'x' | 'y' | 'z';
    const degrees = clamp(Number(explicitRotation[3]), -180, 180);
    actions.push({ type: 'bone', bone, axis, degrees });
    return { raw: input, actions, summary: `${bone} ${axis.toUpperCase()} = ${degrees}°.` };
  }

  if ((text.includes('turn head') || text.includes('look')) && (text.includes('left') || text.includes('right'))) {
    const amount = clamp(Math.abs(numberFrom(text, 20)), 0, 75);
    const degrees = text.includes('right') ? -amount : amount;
    actions.push({ type: 'bone', bone: 'head', axis: 'y', degrees });
    return { raw: input, actions, summary: `Head turn ${text.includes('right') ? 'right' : 'left'} ${amount}°.` };
  }

  if ((text.includes('look') || text.includes('head')) && (text.includes('up') || text.includes('down'))) {
    const amount = clamp(Math.abs(numberFrom(text, 15)), 0, 60);
    const degrees = text.includes('up') ? -amount : amount;
    actions.push({ type: 'bone', bone: 'head', axis: 'x', degrees });
    return { raw: input, actions, summary: `Head ${text.includes('up') ? 'up' : 'down'} ${amount}°.` };
  }

  if ((text.includes('raise') || text.includes('lift')) && text.includes('arm')) {
    const side = text.includes('left') ? 'left' : 'right';
    const amount = clamp(Math.abs(numberFrom(text, 45)), 0, 160);
    actions.push({
      type: 'bone',
      bone: side === 'left' ? 'leftUpperArm' : 'rightUpperArm',
      axis: 'z',
      degrees: side === 'left' ? -amount : amount,
    });
    return { raw: input, actions, summary: `Raise ${side} arm ${amount}°.` };
  }

  if ((text.includes('bend') || text.includes('flex')) && (text.includes('elbow') || text.includes('arm'))) {
    const side = text.includes('left') ? 'left' : 'right';
    const amount = clamp(Math.abs(numberFrom(text, 60)), 0, 150);
    actions.push({ type: 'bone', bone: side === 'left' ? 'leftLowerArm' : 'rightLowerArm', axis: 'x', degrees: -amount });
    return { raw: input, actions, summary: `Bend ${side} elbow ${amount}°.` };
  }

  const boneAlias = findBoneAlias(text);
  if (boneAlias) {
    const bone = BONE_ALIASES[boneAlias];
    const amount = clamp(numberFrom(text, 20), -180, 180);
    const axis: 'x' | 'y' | 'z' = text.includes(' x ') ? 'x' : text.includes(' z ') ? 'z' : 'y';
    actions.push({ type: 'bone', bone, axis, degrees: amount });
    return { raw: input, actions, summary: `${bone} ${axis.toUpperCase()} = ${amount}°.` };
  }

  return {
    raw: input,
    actions,
    summary: 'Command not recognised yet. Use a precise bone/axis command or one of the built-in natural commands.',
  };
}
