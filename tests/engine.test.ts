import { describe, expect, it } from 'vitest';
import { extractVideoPrompt, parseMotionPrompt } from '../src/engine';

describe('extractVideoPrompt', () => {
  it('extracts explicit video commands', () => {
    expect(extractVideoPrompt('/video Turn toward the camera and smile')).toBe('Turn toward the camera and smile');
  });

  it('extracts natural requests when enabled', () => {
    expect(extractVideoPrompt('Show me walking through the rain')).toBe('walking through the rain');
  });

  it('does not reinterpret normal chat', () => {
    expect(extractVideoPrompt('What do you think about the rain?')).toBeUndefined();
  });
});

describe('parseMotionPrompt', () => {
  it('maps language to a reproducible motion plan', () => {
    const plan = parseMotionPrompt('Slowly move left, zoom closer, hair blowing in the wind');
    expect(plan.panX).toBeLessThan(0);
    expect(plan.zoom).toBeGreaterThan(0);
    expect(plan.speed).toBeLessThan(1);
    expect(plan.actions).toContain('Gentle sway');
  });

  it('provides safe defaults for an unknown prompt', () => {
    const plan = parseMotionPrompt('A mysterious quiet moment');
    expect(plan.actions).toEqual(['Subtle cinematic motion']);
    expect(plan.zoom).toBeGreaterThan(0);
  });
});
