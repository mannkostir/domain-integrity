import { CompilerOptions, NewExpression, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isTransparentConstruction } from '../../../src/analyzers/lifecycle/transparent-constructor';
import { inMemoryProject } from '../../helpers/in-memory';

const LIBRARY = `
export declare class LibraryEvent { constructor(source: object); }
`;

const SET_SEMANTICS: CompilerOptions = { useDefineForClassFields: false };

const construction = (
  source: string,
  extraFiles: Readonly<Record<string, string>> = {},
  compilerOptions: CompilerOptions = {},
): NewExpression =>
  inMemoryProject({ '/types/library.d.ts': LIBRARY, ...extraFiles, '/src/events.ts': source }, compilerOptions)
    .getSourceFileOrThrow('/src/events.ts')
    .getFunctionOrThrow('raise')
    .getFirstDescendantByKindOrThrow(SyntaxKind.NewExpression);

describe('transparent construction', () => {
  it('accepts a constructor that stores its parameter and a built-in date', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  readonly agg: Agg;
  readonly at: Date;
  constructor(agg: Agg) { this.at = new Date(); this.agg = agg; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('accepts a parameter property', () => {
    const expression = construction(`
export class Agg {}
export class Raised { constructor(readonly agg: Agg) {} }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('accepts literal stores and literal initializers', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  kind = 'raised';
  count = 0;
  readonly agg: Agg;
  note: string | null;
  missing: string | undefined;
  tag: string;
  constructor(agg: Agg) { this.agg = agg; this.note = null; this.missing = undefined; this.tag = \`t\`; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('accepts a subclass that forwards to a transparent base through super', () => {
    const expression = construction(`
export class Agg {}
export class Base { constructor(readonly agg: Agg) {} }
export class Raised extends Base { constructor(agg: Agg, readonly note: string) { super(agg); } }
export function raise(agg: Agg) { return new Raised(agg, 'x'); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('accepts a subclass without a constructor over a transparent base', () => {
    const expression = construction(`
export class Agg {}
export class Base { constructor(readonly agg: Agg) {} }
export class Raised extends Base {}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('ignores static initializers, which run when the class is defined', () => {
    const expression = construction(`
export class Agg {}
const register = (): number => 1;
export class Raised { static id = register(); constructor(readonly agg: Agg) {} }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('resolves an event class imported from another module', () => {
    const expression = construction(
      `
import { Agg, Raised } from './raised';
export function raise(agg: Agg) { return new Raised(agg); }
`,
      { '/src/raised.ts': 'export class Agg {}\nexport class Raised { constructor(readonly agg: Agg) {} }\n' },
    );

    expect(isTransparentConstruction(expression)).toBe(true);
  });

  it('rejects a call on the parameter', () => {
    const expression = construction(`
export class Agg { touch(): void {} }
export class Raised { readonly agg: Agg; constructor(agg: Agg) { agg.touch(); this.agg = agg; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a read through the parameter', () => {
    const expression = construction(`
export class Agg { get label(): string { return ''; } }
export class Raised { readonly label: string; constructor(agg: Agg) { this.label = agg.label; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a stored value computed by a function call', () => {
    const expression = construction(`
export class Agg {}
const now = (): number => 0;
export class Raised { readonly at: number; constructor(readonly agg: Agg) { this.at = now(); } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a store into a field with a setter', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  private held?: Agg;
  set agg(value: Agg) { this.held = value; }
  constructor(agg: Agg) { this.agg = agg; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a base store that a setter in the constructed subclass intercepts', () => {
    const expression = construction(`
export class Agg {}
export class Base { agg?: Agg; constructor(agg: Agg) { this.agg = agg; } }
export class Raised extends Base { set agg(value: Agg) { void value; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a store into an undeclared field', () => {
    const expression = construction(`
export class Agg {}
export class Raised { constructor(agg: Agg) { (this as { extra?: Agg }).extra = agg; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a statement other than a store or a super call', () => {
    const expression = construction(`
export class Agg {}
export class Raised { readonly agg: Agg; constructor(agg: Agg) { if (agg) { this.agg = agg; } else { this.agg = agg; } } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a library base class', () => {
    const expression = construction(`
import { LibraryEvent } from '../types/library';
export class Agg {}
export class Raised extends LibraryEvent { constructor(agg: Agg) { super(agg); } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects an unresolved base class', () => {
    const expression = construction(`
import { Missing } from 'not-installed';
export class Agg {}
export class Raised extends Missing { constructor(readonly agg: Agg) { super(); } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects an ambient class declared in a project file', () => {
    const expression = construction(`
export class Agg {}
export declare class Raised { constructor(agg: Agg); }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a decorated class', () => {
    const expression = construction(`
export class Agg {}
const sealed = (target: unknown): void => { void target; };
@sealed
export class Raised { constructor(readonly agg: Agg) {} }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a destructured parameter', () => {
    const expression = construction(`
export class Agg { id = ''; }
export class Raised { readonly id: string; constructor({ id }: Agg) { this.id = id; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a rest parameter', () => {
    const expression = construction(`
export class Agg {}
export class Raised { readonly all: Agg[]; constructor(...all: Agg[]) { this.all = all; } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a parameter default computed by a call', () => {
    const expression = construction(`
export class Agg {}
const now = (): number => 0;
export class Raised { constructor(readonly agg: Agg, readonly at: number = now()) {} }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects an instance initializer computed by a call', () => {
    const expression = construction(`
export class Agg {}
const now = (): number => 0;
export class Raised { at = now(); constructor(readonly agg: Agg) {} }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a built-in construction from a parameter', () => {
    const expression = construction(`
export class Agg {}
export class Raised { readonly at: Date; constructor(agg: Agg) { this.at = new Date(agg as unknown as number); } }
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a base produced by a mixin call', () => {
    const expression = construction(`
export class Agg {}
type Ctor = new (...args: never[]) => object;
export class Plain { constructor(readonly agg: Agg) {} }
export function Guarded<T extends Ctor>(Base: T): T {
  return class extends Base { constructor(...args: never[]) { super(...args); if (args.length > 1) throw new Error('x'); } };
}
export class Raised extends Guarded(Plain) {}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a mixin base that declares a setter', () => {
    const expression = construction(
      `
export class Agg { touch(): void {} }
type Ctor = new (...args: never[]) => object;
export class Plain { constructor(readonly agg: Agg) {} }
export const Intercepting = <T extends Ctor>(Base: T) =>
  class extends Base { set agg(value: Agg) { value.touch(); } };
export class Raised extends Intercepting(Plain) {}
export function raise(agg: Agg) { return new Raised(agg); }
`,
      {},
      SET_SEMANTICS,
    );

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a base reached through a variable', () => {
    const expression = construction(`
export class Agg {}
export class Plain { constructor(readonly agg: Agg) {} }
const Alias = Plain;
export class Raised extends Alias {}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a base reached through a property access', () => {
    const expression = construction(`
export class Agg {}
export class Plain { constructor(readonly agg: Agg) {} }
const bases = { Plain };
export class Raised extends bases.Plain {}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects circular extends without throwing', () => {
    const expression = construction(`
export class Agg {}
export class Raised extends Looped {}
export class Looped extends Raised {}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a class reached through a variable', () => {
    const expression = construction(`
export class Agg {}
export class Raised { constructor(readonly agg: Agg) {} }
const Alias = Raised;
export function raise(agg: Agg) { return new Alias(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a parameter property intercepted by a setter in a base class', () => {
    const expression = construction(
      `
export class Agg { touch(): void {} }
export class Base { set agg(value: Agg) { value.touch(); } }
export class Raised extends Base { constructor(readonly agg: Agg) { super(); } }
export function raise(agg: Agg) { return new Raised(agg); }
`,
      {},
      SET_SEMANTICS,
    );

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects an instance initializer intercepted by a setter in a base class', () => {
    const expression = construction(
      `
export class Agg { touch(): void {} }
export class Base {
  constructor(readonly agg: Agg) {}
  set count(value: number) { void value; this.agg.touch(); }
}
export class Raised extends Base { count = 0; }
export function raise(agg: Agg) { return new Raised(agg); }
`,
      {},
      SET_SEMANTICS,
    );

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a store into a field whose setter has a quoted name', () => {
    const expression = construction(
      `
export class Agg { touch(): void {} }
export class Raised {
  agg!: Agg;
  set 'agg'(value: Agg) { value.touch(); }
  constructor(agg: Agg) { this.agg = agg; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`,
      {},
      SET_SEMANTICS,
    );

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a store into a field that has only a getter', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  get agg(): Agg { return new Agg(); }
  constructor(agg: Agg) { this.agg = agg; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a class with an accessor keyword field', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  accessor agg: Agg;
  constructor(agg: Agg) { this.agg = agg; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });

  it('rejects a store into the prototype field', () => {
    const expression = construction(`
export class Agg {}
export class Raised {
  __proto__: unknown;
  x: string;
  constructor(agg: Agg) { this.__proto__ = agg; this.x = 'a'; }
}
export function raise(agg: Agg) { return new Raised(agg); }
`);

    expect(isTransparentConstruction(expression)).toBe(false);
  });
});
