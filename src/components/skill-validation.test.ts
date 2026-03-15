import { describe, expect, test } from 'bun:test';
import { resolveSkills } from './composer.js';
import { createComponentRegistry, validateComposition } from './registry.js';
import { AgentCompositionSchema } from './types.js';

describe('skill validation', () => {
  test('accepts inline skills without $ref', () => {
    const composition = AgentCompositionSchema.parse({
      name: 'academy-inline-skill',
      persona: {
        role: 'Analyst',
        goal: 'Analyze data',
        backstory: 'Test fixture',
      },
      skills: [
        {
          id: 'web-search',
          capabilities: ['Market research'],
          promptFragment: 'Use web sources.',
        },
      ],
    });

    const result = validateComposition(composition, createComponentRegistry());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects empty skill references', () => {
    const composition = {
      name: 'invalid-skill-ref',
      persona: {
        role: 'Analyst',
        goal: 'Analyze data',
        backstory: 'Test fixture',
      },
      skills: [{ $ref: '   ' }],
    } as any;

    const result = validateComposition(composition, createComponentRegistry());

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`Invalid skill reference at index 0: '$ref' must be a non-empty string`);
  });

  test('skips invalid skill refs while keeping inline skills during resolution', () => {
    const registry = createComponentRegistry();
    const resolved = resolveSkills([
      { $ref: undefined } as any,
      {
        id: 'inline-skill',
        capabilities: ['Structured analysis'],
        promptFragment: 'Stay structured.',
        requiredTools: [],
      },
    ], registry);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe('inline-skill');
  });
});
