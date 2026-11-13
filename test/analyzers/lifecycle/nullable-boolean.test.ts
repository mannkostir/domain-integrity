import { Node } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { setsOf } from '../../../src/analyzers/lifecycle/assigned';
import { candidateFields } from '../../../src/analyzers/lifecycle/candidates';
import { evaluateCondition } from '../../../src/analyzers/lifecycle/guard-condition';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { initialValues } from '../../../src/analyzers/lifecycle/initial';
import { defaultScope, describeAssigned, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const conditions = [
  ['this.state', ['true']],
  ['!this.state', ['false', 'null', 'undefined']],
  ['this.state === true', ['true']],
  ['this.state !== true', ['false', 'null', 'undefined']],
  ['this.state == true', ['true']],
  ['this.state != true', ['false', 'null', 'undefined']],
  ['this.state === false', ['false']],
  ['this.state !== false', ['true', 'null', 'undefined']],
  ['this.state == false', ['false']],
  ['this.state != false', ['true', 'null', 'undefined']],
  ['this.state === null', ['null']],
  ['this.state !== null', ['true', 'false', 'undefined']],
  ['this.state == null', ['null', 'undefined']],
  ['this.state != null', ['true', 'false']],
  ['this.state === undefined', ['undefined']],
  ['this.state !== undefined', ['true', 'false', 'null']],
  ['this.state == undefined', ['null', 'undefined']],
  ['this.state != undefined', ['true', 'false']],
  ['true === this.state', ['true']],
  ['false != this.state', ['true', 'null', 'undefined']],
  ['this.state !== null && this.state !== undefined', ['true', 'false']],
  ['this.state === null || this.state === undefined', ['null', 'undefined']],
] as const;

const shapes: readonly (readonly [string, readonly string[]])[] = [
  ['boolean | null', ['true', 'false', 'null']],
  ['boolean | undefined', ['true', 'false', 'undefined']],
  ['boolean | null | undefined', ['true', 'false', 'null', 'undefined']],
  ['true | null', ['true', 'null']],
  ['false | undefined', ['false', 'undefined']],
  ['false | null | undefined', ['false', 'null', 'undefined']],
  ['true | null | undefined', ['true', 'null', 'undefined']],
  ['false | null', ['false', 'null']],
  ['true | undefined', ['true', 'undefined']],
] as const;

const project = inMemoryProject({
  '/samples.ts': shapes.map(([type], index) => `
export class Sample${index} {
  state: ${type};
  title = '';
  constructor() { this.state = ${type.includes('null') ? 'null' : 'undefined'}; }
  predicate(): boolean { return !!this.state; }
  get effectful(): true { this.state = ${type.includes('null') ? 'null' : 'undefined'}; return true; }
  unknown(): void { if (this.predicate()) return; this.title = 'x'; }
  effect(): void { if (this.state === this.effectful) return; this.title = 'x'; }
  ${shapes[index]![1].map((value) => `assign${value[0]!.toUpperCase()}${value.slice(1)}(): void { this.state = ${value}; }`).join('\n')}
  assignUnion(value: ${type}): void { this.state = value; }
  ${conditions.map(([condition], i) => `guard${i}(): void { if (${condition}) return; this.title = 'x'; }`).join('\n')}
}`).join('\n'),
});

const clsAt = (index: number) => project.getSourceFileOrThrow('/samples.ts').getClassOrThrow(`Sample${index}`);

for (const [index, [type, states]] of shapes.entries()) {
  describe(type, () => {
    const cls = clsAt(index);
    const scope = defaultScope(cls);
    const token = (state: string): string => {
      if (state !== 'null' && state !== 'undefined') return state;
      return states.includes('null') && states.includes('undefined') ? `unset:${state}` : 'unset';
    };

    it('discovers exactly the actual finite values', () => {
      const fields = candidateFields(scope, []);

      expect(fields.map((field) => [field.name, field.values.map((value) => value.token).sort()])).toEqual([
        ['state', [...new Set(states.map((state) => state === 'null' || state === 'undefined' ? 'unset' : state))].sort()],
      ]);
    });

    for (const [conditionIndex, [condition, truthy]] of conditions.entries()) {
      it(`partitions every actual state for ${condition}`, () => {
        const field = resolvedField(cls, 'state');
        const statement = cls.getMethodOrThrow(`guard${conditionIndex}`).getStatements()[0];
        if (!Node.isIfStatement(statement)) throw new Error('missing condition');
        const evaluation = evaluateCondition(statement.getExpression(), field, scope);

        expect(evaluation === 'unknown' ? evaluation : {
          whenTrue: [...evaluation.whenTrue].sort(),
          whenFalse: [...evaluation.whenFalse].sort(),
        }).toEqual({
          whenTrue: states.filter((state) => (truthy as readonly string[]).includes(state)).map(token).sort(),
          whenFalse: states.filter((state) => !(truthy as readonly string[]).includes(state)).map(token).sort(),
        });
      });

      it(`retains the actual starting states after an early exit on ${condition}`, () => {
        const sources = methodSources(cls.getMethodOrThrow(`guard${conditionIndex}`), resolvedField(cls, 'state'), scope);
        const remaining = states.filter((state) => !(truthy as readonly string[]).includes(state));
        const distinguishesUnset = states.includes('null') && states.includes('undefined')
          && remaining.includes('null') !== remaining.includes('undefined');
        const expected = distinguishesUnset ? 'unknown'
          : [...new Set(remaining.map((state) => state === 'null' || state === 'undefined' ? 'unset' : state))].sort();

        expect(describeSources(sources)).toEqual(expected);
      });
    }

    it('keeps false and every unset form after a truthy early return', () => {
      const sources = methodSources(cls.getMethodOrThrow('guard0'), resolvedField(cls, 'state'), scope);

      expect(describeSources(sources)).toEqual([...new Set(states.filter((state) => state !== 'true').map((state) => state === 'false' ? state : 'unset'))].sort());
    });

    it.each(['unknown', 'effect'])('leaves %s guard sources unknown', (method) => {
      expect(describeSources(methodSources(cls.getMethodOrThrow(method), resolvedField(cls, 'state'), scope))).toBe('unknown');
    });

    it('keeps unset forms distinguishable for a strict null guard', () => {
      const sources = methodSources(cls.getMethodOrThrow('guard10'), resolvedField(cls, 'state'), scope);
      const expected = states.includes('null') && states.includes('undefined')
        ? 'unknown'
        : states.filter((state) => state !== 'null').map((state) => state === 'undefined' ? 'unset' : state).sort();

      expect(describeSources(sources)).toEqual(expected);
    });

    it('covers both unset forms with a loose null guard', () => {
      const sources = methodSources(cls.getMethodOrThrow('guard12'), resolvedField(cls, 'state'), scope);

      expect(describeSources(sources)).toEqual(states.filter((state) => state === 'true' || state === 'false').sort());
    });

    it('records the constructor unset initial value', () => {
      expect(describeAssigned(initialValues(cls, resolvedField(cls, 'state')))).toEqual({ tokens: ['unset'], unresolved: false, mayWrite: false });
    });

    it.each(states)('records assignment of %s', (value) => {
      const method = cls.getMethodOrThrow(`assign${value[0]!.toUpperCase()}${value.slice(1)}`);

      expect(describeAssigned(setsOf(method, resolvedField(cls, 'state')))).toEqual({
        tokens: [value === 'null' || value === 'undefined' ? 'unset' : value],
        unresolved: false,
        mayWrite: false,
      });
    });

    it('keeps union-valued assignments unresolved', () => {
      expect(describeAssigned(setsOf(cls.getMethodOrThrow('assignUnion'), resolvedField(cls, 'state')))).toEqual({ tokens: [], unresolved: true, mayWrite: false });
    });
  });
}

describe('nullable boolean initializers', () => {
  it.each(['true', 'false', 'null', 'undefined'])('records the initial value %s', (initial) => {
    const initialized = inMemoryProject({ '/initialized.ts': `export class Sample { state: boolean | null | undefined = ${initial}; }` });
    const cls = initialized.getSourceFileOrThrow('/initialized.ts').getClassOrThrow('Sample');

    expect(describeAssigned(initialValues(cls, resolvedField(cls, 'state')))).toEqual({
      tokens: [initial === 'null' || initial === 'undefined' ? 'unset' : initial], unresolved: false, mayWrite: false,
    });
  });

  it('discovers an optional boolean field', () => {
    const optional = inMemoryProject({ '/optional.ts': 'export class Sample { state?: boolean; }' });
    const cls = optional.getSourceFileOrThrow('/optional.ts').getClassOrThrow('Sample');

    expect(candidateFields(defaultScope(cls), []).map((field) => ({ name: field.name, unsetForms: field.unsetForms, tokens: field.values.map((value) => value.token) })))
      .toEqual([{ name: 'state', unsetForms: ['undefined'], tokens: ['true', 'false', 'unset'] }]);
  });
});
