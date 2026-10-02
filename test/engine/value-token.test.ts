import { describe, expect, it } from 'vitest';
import { literalToken } from '../../src/engine/value-token';
import { inMemoryProject } from '../helpers/in-memory';

const project = inMemoryProject({
  '/values.ts': `
export enum Named { a = 'A', b = 'B' }
export enum Numbered { x, y }
export const named = Named.b;
export const numbered = Numbered.y;
export const text = 'hello' as const;
export const flag = true as const;
export const date = new Date();
`,
});

const typeOf = (name: string) =>
  project.getSourceFileOrThrow('/values.ts').getVariableDeclarationOrThrow(name).getInitializerOrThrow().getType();

describe('literalToken', () => {
  it.each([
    ['named', 'B'],
    ['numbered', '1'],
    ['text', 'hello'],
    ['flag', 'true'],
  ])('turns the literal type of %s into %s', (name, token) => {
    expect(literalToken(typeOf(name))).toBe(token);
  });

  it('returns undefined for a non-literal type', () => {
    expect(literalToken(typeOf('date'))).toBeUndefined();
  });
});
