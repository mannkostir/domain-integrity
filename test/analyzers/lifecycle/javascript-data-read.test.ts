import { describe, expect, it } from 'vitest';
import { isJavaScriptScalarValue } from '../../../src/analyzers/lifecycle/field-ref';
import { inMemoryProject } from '../../helpers/in-memory';

const cases = [
  ['string', true],
  ["'label'", true],
  ['number', true],
  ['42', true],
  ['boolean', true],
  ['false', true],
  ['bigint', true],
  ['1n', true],
  ['symbol', true],
  ['typeof unique', true],
  ['null', true],
  ['undefined', true],
  ['State', true],
  ['State.Open', true],
  ['`id-${number}`', true],
  ['string | number | boolean | bigint | symbol | null | undefined', true],
  ["'open' | 'closed' | null | undefined", true],
  ['State | null | undefined', true],
  ['Date', false],
  ['String', false],
  ['Number', false],
  ['Boolean', false],
  ['string[]', false],
  ['readonly string[]', false],
  ['[string, number]', false],
  ['Promise<string>', false],
  ['Map<string, number>', false],
  ['Set<string>', false],
  ['RegExp', false],
  ['object', false],
  ['{}', false],
  ['Record<string, string>', false],
  ['() => string', false],
  ['any', false],
  ['unknown', false],
  ['never', false],
  ['string | Date', false],
  ['Date | null | undefined', false],
  ['string | (() => string)', false],
  ['string & { readonly brand: unique symbol }', false],
  ['void', false],
] as const;

const project = inMemoryProject({ '/types.ts': `
  declare const unique: unique symbol;
  enum State { Open, Closed }
  ${cases.map(([type], index) => `function sample${index}(value: ${type}) { return value; }`).join('\n')}
  function generic<T>(value: T) { return value; }
  function constrained<T extends string>(value: T) { return value; }
  function conditional<T>(value: T extends string ? string : Date) { return value; }
` }, { noEmit: true });
const file = project.getSourceFileOrThrow('/types.ts');

describe('JavaScript scalar read eligibility', () => {
  it('uses diagnostic-free ordinary TypeScript parameter types', () => {
    expect(project.getPreEmitDiagnostics()).toEqual([]);
  });

  for (const [index, [type, expected]] of cases.entries()) {
    it(`${expected ? 'admits' : 'withholds'} ${type}`, () => {
      const value = file.getFunctionOrThrow(`sample${index}`).getParameters()[0]!;

      expect(isJavaScriptScalarValue(value.getType())).toBe(expected);
    });
  }

  for (const name of ['generic', 'constrained', 'conditional']) {
    it(`withholds unsupported ${name} types`, () => {
      const value = file.getFunctionOrThrow(name).getParameters()[0]!;

      expect(isJavaScriptScalarValue(value.getType())).toBe(false);
    });
  }
});
