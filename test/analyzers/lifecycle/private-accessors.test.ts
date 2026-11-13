import { describe, expect, it } from 'vitest';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const projectWith = (baseMembers: string, derivedMembers: string, statement: string) => inMemoryProject({
  '/src/order.ts': `
class Base {
  protected status: 'pending' | 'paid' | 'cancelled' = 'pending';
  protected title = '';
  protected count = 0;
  ${baseMembers}
  rename(): void { ${statement} }
}
export class Order extends Base { ${derivedMembers} }
`,
});

const sourcesOf = (baseMembers: string, derivedMembers: string, statement: string, analyzedClass = 'Order') => {
  const file = projectWith(baseMembers, derivedMembers, statement).getSourceFileOrThrow('/src/order.ts');
  const base = file.getClassOrThrow('Base');
  const order = file.getClassOrThrow(analyzedClass);
  return describeSources(methodSources(base.getMethodOrThrow('rename'), resolvedField(order, 'status'), defaultScope(order)));
};

const guardedPrivate = `
get #label(): string { return this.status; }
set #label(value: string) {
  if (this.status === 'cancelled') throw new Error('closed');
  this.title = value;
}
`;

const inertPrivate = `
get #label(): string { return this.status; }
set #label(value: string) { this.title = value; }
`;

const guardedNumericPrivate = `
get #label(): number {
  if (this.status === 'cancelled') throw new Error('closed');
  return this.count;
}
set #label(value: number) { this.count = value; }
`;

const inertNumericPrivate = `
get #label(): number { return this.count; }
set #label(value: number) { this.count = value; }
`;

describe('private accessor lexical identity', () => {
  it('traces the guarded base setter used by the inherited method', () => {
    expect(sourcesOf(guardedPrivate, 'set #label(value: string) { this.title = value; }', "this.#label = 'x';")).toBe('unknown');
  });

  it('does not trace an unrelated derived private setter guard', () => {
    expect(sourcesOf(inertPrivate, guardedPrivate, "this.#label = 'x';")).toEqual(['cancelled', 'paid', 'pending']);
  });

  it.each(['this.#label += 1;', 'this.#label++;', '--this.#label;'])('traces the lexical getter for %s', (statement) => {
    expect(sourcesOf(guardedNumericPrivate, inertNumericPrivate, statement)).toBe('unknown');
  });

  it.each(['this.#label += 1;', 'this.#label++;', '--this.#label;'])('ignores an unrelated derived getter for %s', (statement) => {
    expect(sourcesOf(inertNumericPrivate, guardedNumericPrivate, statement)).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('still bypasses a private getter for a proven plain write', () => {
    expect(sourcesOf(inertPrivate, guardedPrivate, "if (this.status === 'cancelled') return; this.#label = 'x';")).toEqual(['paid', 'pending']);
  });

  it('keeps public accessors virtual in an inherited method', () => {
    expect(sourcesOf(guardedPrivate.replaceAll('#label', 'label'), inertPrivate.replaceAll('#label', 'label'), "this.label = 'x';")).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('does not treat a string element key as a private brand', () => {
    expect(sourcesOf(`
      ${inertPrivate}
      get '#label'(): string { return this.status; }
      set '#label'(value: string) {
        if (this.status === 'cancelled') throw new Error('closed');
        this.title = value;
      }
    `, '', "this['#label'] = 'x';")).toBe('unknown');
  });

  it('keeps an ordinary hash-prefixed string key virtual', () => {
    const base = guardedPrivate.replaceAll('#label', "'#label'");
    const derived = inertPrivate.replaceAll('#label', "'#label'");

    expect(sourcesOf(base, derived, "this['#label'] = 'x';")).toEqual(['cancelled', 'paid', 'pending']);
  });
});


describe('private accessors on their declaring class', () => {
  it('judges a plain write through its own unrelated setter', () => {
    expect(sourcesOf(inertPrivate, '', "this.#label = 'x';", 'Base')).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('keeps its own guarded setter unknown', () => {
    expect(sourcesOf(guardedPrivate, '', "this.#label = 'x';", 'Base')).toBe('unknown');
  });

  it('keeps its own guarded getter unknown during update', () => {
    expect(sourcesOf(guardedNumericPrivate, '', 'this.#label++;', 'Base')).toBe('unknown');
  });
});

describe('private lexical fixtures', () => {
  it.each([
    [guardedPrivate, 'set #label(value: string) { this.title = value; }', "this.#label = 'x';"],
    [inertPrivate, guardedPrivate, "this.#label = 'x';"],
    [guardedNumericPrivate, inertNumericPrivate, 'this.#label++;'],
    [inertNumericPrivate, guardedNumericPrivate, 'this.#label += 1;'],
    [guardedPrivate.replaceAll('#label', "'#label'"), inertPrivate.replaceAll('#label', "'#label'"), "this['#label'] = 'x';"],
  ])('typechecks lexical and ordinary accessor shapes %#', (base, derived, statement) => {
    expect(projectWith(base, derived, statement).getPreEmitDiagnostics()).toEqual([]);
  });
});

describe('private accessor guards and writes', () => {
  it('reads a private getter guard from its lexical owner', () => {
    expect(sourcesOf(
      "get #open(): boolean { return this.status !== 'cancelled'; }",
      'get #open(): boolean { return true; }',
      "if (!this.#open) return; this.title = 'x';",
    )).toEqual(['paid', 'pending']);
  });

  it('uses the derived brand in a method declared by the derived class', () => {
    const project = projectWith(guardedPrivate, `${inertPrivate} rename(): void { this.#label = 'x'; }`, "this.#label = 'x';");
    const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

    expect(describeSources(methodSources(cls.getMethodOrThrow('rename'), resolvedField(cls, 'status'), defaultScope(cls)))).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('preserves guards before a lexical transparent state-writing setter', () => {
    expect(sourcesOf(
      inertPrivate.replace('this.title = value;', "this.status = 'paid';"),
      inertPrivate,
      "if (this.status === 'cancelled') return; this.#label = 'x';",
    )).toEqual(['paid', 'pending']);
  });
});

describe('lexical private helpers reached through accessors', () => {
  const guardedMethod = "#assertOpen(): void { if (this.status === 'cancelled') throw new Error('closed'); }";
  const inertMethod = '#assertOpen(): void {}';
  const guardedArrow = "#assertOpen = (): void => { if (this.status === 'cancelled') throw new Error('closed'); };";
  const inertArrow = '#assertOpen = (): void => {};';
  const setterCallingHelper = `
    get #label(): string { return this.status; }
    set #label(value: string) { this.#assertOpen(); this.title = value; }
  `;
  const getterCallingHelper = `
    get #label(): number { this.#assertOpen(); return this.count; }
    set #label(value: number) { this.count = value; }
  `;

  it.each([
    ['method', guardedMethod, inertMethod],
    ['arrow', guardedArrow, inertArrow],
  ])('traces the lexical private %s helper called by a base setter', (_kind, guarded, inert) => {
    expect(sourcesOf(setterCallingHelper + guarded, inert, "this.#label = 'x';")).toBe('unknown');
  });

  it.each([
    ['method', inertMethod, guardedMethod],
    ['arrow', inertArrow, guardedArrow],
  ])('does not trace a derived private %s helper called only by the derived brand', (_kind, inert, guarded) => {
    expect(sourcesOf(setterCallingHelper + inert, guarded, "this.#label = 'x';")).toEqual(['cancelled', 'paid', 'pending']);
  });

  it.each([
    ['method', guardedMethod, inertMethod, 'this.#label += 1;'],
    ['method', guardedMethod, inertMethod, 'this.#label++;'],
    ['arrow', guardedArrow, inertArrow, 'this.#label += 1;'],
    ['arrow', guardedArrow, inertArrow, '--this.#label;'],
  ])('traces the lexical %s helper called by a getter during %s', (_kind, guarded, inert, statement) => {
    expect(sourcesOf(getterCallingHelper + guarded, inert, statement)).toBe('unknown');
  });

  it('follows its declaring class private method helper', () => {
    expect(sourcesOf(setterCallingHelper + guardedMethod, inertMethod, "this.#label = 'x';", 'Base')).toBe('unknown');
  });

  it('follows its declaring class private arrow helper', () => {
    expect(sourcesOf(setterCallingHelper + guardedArrow, inertArrow, "this.#label = 'x';", 'Base')).toBe('unknown');
  });

  it('retains public virtual method dispatch from a lexical private setter', () => {
    expect(sourcesOf(
      (setterCallingHelper + guardedMethod).replaceAll('#assertOpen', 'assertOpen'),
      inertMethod.replace('#assertOpen', 'assertOpen'),
      "this.#label = 'x';",
    )).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('does not resolve an ordinary string helper key to a private method', () => {
    expect(sourcesOf(`
      ${setterCallingHelper.replace('this.#assertOpen()', "this['#assertOpen']()")}
      ${inertMethod}
      '#assertOpen'(): void { if (this.status === 'cancelled') throw new Error('closed'); }
    `, '', "this.#label = 'x';")).toBe('unknown');
  });

  it.each([
    [setterCallingHelper + guardedMethod, inertMethod, "this.#label = 'x';"],
    [setterCallingHelper + guardedArrow, inertArrow, "this.#label = 'x';"],
    [getterCallingHelper + guardedMethod, inertMethod, 'this.#label++;'],
    [getterCallingHelper + guardedArrow, inertArrow, 'this.#label += 1;'],
  ])('typechecks private helper fixture %#', (base, derived, statement) => {
    expect(projectWith(base, derived, statement).getPreEmitDiagnostics()).toEqual([]);
  });
});

describe('private helper implementation boundaries', () => {
  it('keeps a call to a private function property without an implementation unknown', () => {
    expect(sourcesOf(`
      get #label(): string { return this.status; }
      set #label(value: string) { this.#check(); this.title = value; }
      #check!: () => void;
    `, '#check(): void {}', "this.#label = 'x';")).toBe('unknown');
  });

  it.each([
    ["#check(): void { if (this.status === 'cancelled') throw new Error('closed'); }", '#check = (): void => {};'],
    ["#check = (): void => { if (this.status === 'cancelled') throw new Error('closed'); };", '#check(): void {}'],
  ])('preserves private identity across method and arrow declaration shapes %#', (base, derived) => {
    expect(sourcesOf(`
      get #label(): string { return this.status; }
      set #label(value: string) { this.#check(); this.title = value; }
      ${base}
    `, derived, "this.#label = 'x';")).toBe('unknown');
  });

  it.each([
    ["#check(): void { if (this.status === 'cancelled') throw new Error('closed'); }", '#check(): void {}'],
    ["#check = (): void => { if (this.status === 'cancelled') throw new Error('closed'); };", '#check = (): void => {};'],
  ])('uses the lexical assertion helper for a direct call %#', (base, derived) => {
    expect(sourcesOf(base, derived, "this.#check(); this.title = 'x';")).toEqual(['paid', 'pending']);
  });
});
