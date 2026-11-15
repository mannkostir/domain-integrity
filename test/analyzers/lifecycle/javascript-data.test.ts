import { ClassDeclaration, Node, Symbol as MorphSymbol, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { JavaScriptDataProperties } from '../../../src/analyzers/lifecycle/javascript-data';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { analysedSourceFiles } from '../../../src/engine/project';
import { assignedValue } from '../../../src/analyzers/lifecycle/assigned';
import { describeAssigned, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const proveJavaScriptDataProperty = (cls: ClassDeclaration, symbol: MorphSymbol | undefined) =>
  new JavaScriptDataProperties(new SourceIndex(cls.getProject().getSourceFiles())).prove(cls, symbol);

const sample = (source: string, additional: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({ '/sample.js': source, ...additional }, { allowJs: true, checkJs: true, noEmit: true });
  const cls = project.getSourceFileOrThrow('/sample.js').getClassOrThrow('Sample');
  return { project, cls, symbol: cls.getType().getProperty('closed') };
};

const PLAIN = `
export class Sample {
  constructor() { this.closed = false; this.label = ''; this['ready'] = true; }
  close() { this.closed = true; }
  rename(label = '') { this.label = label; }
}
`;

describe('JavaScript constructor data proof', () => {
  it('uses a checkJs-valid Boolean lifecycle and unrelated label fixture', () => {
    const { project } = sample(PLAIN);

    expect(project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(['closed', 'label', 'ready'])('proves the constructor data slot %s', (name) => {
    const { cls } = sample(PLAIN);

    expect(proveJavaScriptDataProperty(cls, cls.getType().getProperty(name)).kind).toBe('data');
  });

  it('observes actual BinaryExpression declarations for implicit fields', () => {
    const { symbol } = sample(PLAIN);

    expect(symbol?.getDeclarations().map((declaration) => declaration.getKindName())).toEqual(['BinaryExpression', 'BinaryExpression']);
  });

  it.each([
    "export class Sample { constructor() { this['closed'] = false; } }",
    'export class Sample { constructor() { this["closed"] = false; } }',
    'export class Sample { constructor() { this.closed = false; this.closed = true; } }',
    'class Base { constructor() { this.closed = false; } } export class Sample extends Base {}',
    "class Base { constructor() { this.closed = false; } } export class Sample extends Base { constructor() { super(); this.label = ''; } }",
    'class Base { constructor() { this.closed = false; } } export class Sample extends Base { constructor() { super(); this.closed = true; } }',
    "class Base {} export class Sample extends Base { constructor() { super(); this.closed = false; } }",
    "export class Sample { constructor(label = '') { this.closed = false; this.label = ''; } }",
  ])('proves a plain slot in %s', (source) => {
    const { cls, symbol } = sample(source);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('data');
  });

  it('proves a slot inherited from an imported project JavaScript base', () => {
    const { cls, symbol } = sample("import { Base } from './base.js'; export class Sample extends Base {}", {
      '/base.js': 'export class Base { constructor() { this.closed = false; } }',
    });

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('data');
  });

  it('returns the actual constructor writes without treating method writes as initializers', () => {
    const { cls, symbol } = sample(PLAIN);
    const proof = proveJavaScriptDataProperty(cls, symbol);

    expect(proof.kind === 'data' ? proof.constructorAssignments.map((assignment) => assignment.getText()) : proof.kind).toEqual(['this.closed = false']);
  });

  it('returns base constructor stores before derived constructor stores', () => {
    const { cls, symbol } = sample('class Base { constructor() { this.closed = false; } } export class Sample extends Base { constructor() { super(); this.closed = true; } }');
    const proof = proveJavaScriptDataProperty(cls, symbol);

    expect(proof.kind === 'data' ? proof.constructorAssignments.map((assignment) => assignment.getText()) : proof.kind).toEqual(['this.closed = false', 'this.closed = true']);
  });

  it('keeps a slot unknown if another constructor store can invoke an inherited setter', () => {
    const { cls, symbol } = sample("class Base { get label() { return ''; } set label(value) {} } export class Sample extends Base { constructor() { super(); this.closed = false; this.label = ''; } }");

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it('keeps a project-external JavaScript parent unknown', () => {
    const { cls, symbol } = sample("import { Base } from 'base'; export class Sample extends Base { constructor() { super(); this.closed = false; } }", {
      '/node_modules/base/index.js': 'export class Base {}',
    });

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it('does not prove manually added JavaScript sources when allowJs is off', () => {
    const { project, cls, symbol } = sample(PLAIN);
    project.compilerOptions.set({ allowJs: false, checkJs: false });

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it.each([
    'export class Sample { constructor(flag = false) { if (flag) this.closed = false; } }',
    'export class Sample { constructor() { (() => { this.closed = false; })(); } }',
    'export class Sample { constructor() { const self = this; self.closed = false; } }',
    "export class Sample { constructor() { const other = {}; other.closed = false; } }",
    "export class Sample { constructor(key = 'closed') { this[key] = false; } }",
    "export class Sample { constructor() { this[`closed`] = false; } }",
    'export class Sample { constructor() { this.closed ||= false; } }',
    'export class Sample { constructor() { this.closed = {}; } }',
    'export class Sample { constructor() { this.closed = makeValue(); } }',
    'export class Sample { constructor() { this.closed = false; return {}; } }',
    'class Base {} export class Sample extends Base { constructor() { this.closed = false; } }',
    'class Base { constructor() { this.closed = false; } } export class Sample extends Base { constructor() { super(); return {}; } }',
    'export class Sample { constructor() { this.closed = false; Object.setPrototypeOf(this, {}); } }',
    'export class Sample { constructor(value = makeValue()) { this.closed = false; } }',
    "export class Sample { constructor({ value } = {}) { this.closed = false; } }",
    'export class Sample { constructor() { this.__proto__ = {}; this.closed = false; } }',
    'export class Sample { constructor() { this.closed = false; } get closed() { return false; } set closed(value) {} }',
    'export class Sample { get closed() { return false; } constructor() { this.closed = false; } }',
    'class Base { get closed() { return false; } set closed(value) {} } export class Sample extends Base { constructor() { super(); this.closed = false; } }',
    'class Base { get closed() { return false; } } export class Sample extends Base { constructor() { super(); this.closed = false; } }',
    'class Base { constructor() { this.closed = false; } } export class Sample extends Base { get closed() { return false; } }',
    'class Base { constructor() { this.closed = false; } } export class Sample extends Base { get closed() { return false; } set closed(value) {} }',
    'class Base { constructor() { this.closed = false; return {}; } } export class Sample extends Base {}',
    'export class Sample extends Missing { constructor() { super(); this.closed = false; } }',
    'export class Sample extends Array { constructor() { super(); this.closed = false; } }',
    'export class Sample { static closed = false; }',
    'export class Sample { static initialize() { this.closed = false; } }',
    'export class Sample { closed = false; }',
    "export class Sample { constructor() { this.closed = false; } static { Object.defineProperty(this.prototype, 'closed', {}); } }",
    "export class Sample { constructor() { this.closed = false; } } Object.defineProperty(Sample.prototype, 'closed', { set(value) {} });",
    "export class Sample { constructor() { this.closed = false; } } Object.defineProperty(Object.prototype, 'closed', { set(value) {} });",
    "class Base {} export class Sample extends Base { constructor() { super(); this.closed = false; } } Base.prototype.closed = false;",
    "export class Sample { constructor() { this.closed = false; } } const alias = Sample; mutate(alias);",
    'export class Sample { constructor() { this.closed = false; } change() { (() => { this.closed = true; })(); } }',
    "export class Sample { constructor() { this.closed = false; } get ['other']() { return false; } }",
  ])('keeps unsupported creation unknown in %s', (source) => {
    const { cls, symbol } = sample(source);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it('keeps an inherited quoted accessor from masquerading as an own slot', () => {
    const { cls, symbol } = sample("class Base { get 'closed'() { return false; } set 'closed'(value) {} } export class Sample extends Base { constructor() { super(); this['closed'] = false; } }");

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it.each([
    ['destructured APIs', `const { defineProperty, getPrototypeOf } = Object; defineProperty(getPrototypeOf({}), 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['renamed destructured APIs', `const { defineProperty: define, getPrototypeOf: proto } = Object; define(proto({}), 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['template keys', "Object[`defineProperty`](Object[`prototype`], 'closed', { set(value) {}, get() { return true; }, configurable: true });"],
    ['literal-typed computed keys', `const define = 'defineProperty'; const proto = 'prototype'; Object[define](Object[proto], 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['computed destructured keys', `const key = 'defineProperty'; const { [key]: define, getPrototypeOf: proto } = Object; define(proto({}), 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['destructuring assignment', `let define = Object.assign; ({ defineProperty: define } = Object);`],
    ['unresolved computed access', `export function inspect(target = {}, key = '') { return target[key]; }`],
    ['unresolved computed binding', `export function inspect(target = {}, key = '') { const { [key]: value } = target; return value; }`],
    ['object rest binding', `const { ...operations } = Object;`],
    ['descriptor API extraction', `const define = Object.getOwnPropertyDescriptor(Object, 'defineProperty')?.value; const proto = Object.getOwnPropertyDescriptor(Object, 'getPrototypeOf')?.value; define(proto({}), 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['Reflect API extraction', `const define = Reflect.get(Object, 'defineProperty'); const proto = Reflect.get(Object, 'getPrototypeOf'); define(proto({}), 'closed', { set(value) {}, get() { return true; }, configurable: true });`],
    ['dynamic constructor capability', `const create = (() => {}).constructor;`],
    ['dynamic evaluation capability', `const evaluate = eval;`],

  ])('keeps potentially interfering %s unknown', (_name, mutation) => {
    const { cls, symbol } = sample(`${mutation} export class Sample { constructor() { this.closed = false; } }`);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it.each([
    `const key = 'length'; const size = 'text'[key];`,
    `const { length } = 'text';`,
  ])('preserves ordinary data with proven unrelated keys in %s', (prefix) => {
    const { cls, symbol } = sample(`${prefix} export class Sample { constructor() { this.closed = false; } }`);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('data');
  });

  it('keeps a declaration-file parent unknown', () => {
    const { cls, symbol } = sample("import { Base } from './base'; export class Sample extends Base { constructor() { super(); this.closed = false; } }", {
      '/base.d.ts': 'export declare class Base {}',
    });

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it('rejects a symbol from another class even when its name matches', () => {
    const { cls, project } = sample('export class Sample { constructor() { this.closed = false; } } class Foreign { constructor() { this.closed = false; } }');
    const foreign = project.getSourceFileOrThrow('/sample.js').getClassOrThrow('Foreign').getType().getProperty('closed');

    expect(proveJavaScriptDataProperty(cls, foreign).kind).toBe('unknown');
  });

  it('does not classify TypeScript parameter properties', () => {
    const project = inMemoryProject({ '/sample.ts': 'export class Sample { constructor(public closed = false) {} }' });
    const cls = project.getSourceFileOrThrow('/sample.ts').getClassOrThrow('Sample');

    expect(proveJavaScriptDataProperty(cls, cls.getType().getProperty('closed')).kind).toBe('unknown');
  });

  it('does not classify a property signature as a JavaScript constructor declaration', () => {
    const project = inMemoryProject({ '/sample.ts': 'export class Sample { closed!: boolean; } export interface Shape { closed: boolean; }' });
    const cls = project.getSourceFileOrThrow('/sample.ts').getClassOrThrow('Sample');
    const symbol = project.getSourceFileOrThrow('/sample.ts').getInterfaceOrThrow('Shape').getType().getProperty('closed');

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });

  it('keeps a method-only assignment unknown without a constructor store', () => {
    const { cls } = sample('export class Sample { close() { this.closed = true; } }');
    const assignment = cls.getMethodOrThrow('close').getFirstDescendantByKindOrThrow(SyntaxKind.BinaryExpression);

    expect(proveJavaScriptDataProperty(cls, Node.isPropertyAccessExpression(assignment.getLeft()) ? assignment.getLeft().getSymbol() : undefined).kind).toBe('unknown');
  });
});

const STATIC_CONFIG = `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Sample } from './sample.js';
export default defineDomain({ lifecycles: [lifecycle(Sample, { states: { closed: { terminal: [true] } } })] });
`;

describe('JavaScript runtime-source proof context', () => {
  it('proves a class referenced by its excluded static lifecycle config', () => {
    const { project, cls, symbol } = sample(PLAIN, { '/domain.config.ts': STATIC_CONFIG });
    const config = project.getSourceFileOrThrow('/domain.config.ts');
    const proof = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project, config)));

    expect(proof.prove(cls, symbol).kind).toBe('data');
  });

  it('uses a diagnostic-free static config fixture', () => {
    const { project } = sample(PLAIN, { '/domain.config.ts': STATIC_CONFIG });

    expect(project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
  });

  it('keeps the same lifecycle-shaped call unknown in included runtime code', () => {
    const { project, cls, symbol } = sample(PLAIN, {
      '/runtime.ts': `import { Sample } from './sample.js'; function lifecycle(value: unknown) { return value; } lifecycle(Sample);`,
    });
    const proof = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project)));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('ignores harmless metadata spellings confined to excluded config', () => {
    const { project, cls, symbol } = sample(PLAIN, { '/domain.config.ts': STATIC_CONFIG + `export const keys = Object.keys({ prototype: 'display' });` });
    const config = project.getSourceFileOrThrow('/domain.config.ts');
    const proof = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project, config)));

    expect(proof.prove(cls, symbol).kind).toBe('data');
  });

  it('retains prototype barriers from another included runtime file', () => {
    const { project, cls, symbol } = sample(PLAIN, {
      '/domain.config.ts': STATIC_CONFIG,
      '/mutation.js': `Object.defineProperty(Object.prototype, 'closed', { set(value) {}, get() { return true; }, configurable: true });`,
    });
    const config = project.getSourceFileOrThrow('/domain.config.ts');
    const proof = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project, config)));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('does not silently discard an explicitly included external-looking mutation file', () => {
    const { project, cls, symbol } = sample(PLAIN, {
      '/node_modules/mutation/index.js': `Object.defineProperty(Object.prototype, 'closed', { set(value) {}, get() { return true; }, configurable: true });`,
    });
    const proof = new JavaScriptDataProperties(new SourceIndex(project.getSourceFiles()));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('keeps property proofs distinct when a context is reused', () => {
    const { project, cls } = sample(`export class Sample { constructor(closed = false, label = '') { this.closed = closed; this.label = label; } close() { this.closed = true; } }`);
    const proof = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project)));

    expect(['closed', 'label', 'close'].map((name) => proof.prove(cls, cls.getType().getProperty(name)).kind)).toEqual(['data', 'data', 'unknown']);
  });

  it('does not replace an empty analysis source set with all Project files', () => {
    const { cls, symbol } = sample(PLAIN);
    const proof = new JavaScriptDataProperties(new SourceIndex([]));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('does not certify a requested class absent from its runtime source set', () => {
    const { project, cls, symbol } = sample(PLAIN, { '/other.js': 'export const other = false;' });
    const proof = new JavaScriptDataProperties(new SourceIndex([project.getSourceFileOrThrow('/other.js')]));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('requires a project ancestor to be included in the same runtime source set', () => {
    const { project, cls, symbol } = sample(`import { Base } from './base.js'; export class Sample extends Base { constructor() { super(); this.closed = false; } }`, {
      '/base.js': 'export class Base {}',
    });
    const proof = new JavaScriptDataProperties(new SourceIndex([project.getSourceFileOrThrow('/sample.js')]));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('rejects source files from a different Project with the same path', () => {
    const { cls, symbol } = sample(PLAIN);
    const foreign = sample(PLAIN);
    const proof = new JavaScriptDataProperties(new SourceIndex(foreign.project.getSourceFiles()));

    expect(proof.prove(cls, symbol).kind).toBe('unknown');
  });

  it('does not share cached prototype facts across analysis lifetimes', () => {
    const { project, cls, symbol } = sample(PLAIN);
    const first = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project)));
    first.prove(cls, symbol);
    project.createSourceFile('/mutation.js', `Object.defineProperty(Object.prototype, 'closed', { set(value) {}, get() { return true; }, configurable: true });`);
    const second = new JavaScriptDataProperties(new SourceIndex(analysedSourceFiles(project)));

    expect(second.prove(cls, cls.getType().getProperty('closed')).kind).toBe('unknown');
  });
});

describe('JavaScript constructor parameter stores', () => {
  it.each([
    `export class Sample { constructor(closed) { this.closed = closed; } }`,
    `export class Sample { constructor(closed = false) { this.closed = closed; } }`,
    `export class Sample { constructor(label = '') { this.closed = false; this.label = label; } }`,
    `export class Sample { constructor(closed = false, label = '') { this['closed'] = closed; this.label = label; } }`,
    `class Base { constructor(closed = false) { this.closed = closed; } } export class Sample extends Base { constructor(closed = false) { super(closed); } }`,
    `class Base { constructor(label = '') { this.label = label; } } export class Sample extends Base { constructor(label = '') { super(label); this.closed = false; } }`,
  ])('proves a slot without interpreting the parameter value in %s', (source) => {
    const { cls, symbol } = sample(source);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('data');
  });

  it('retains a parameter RHS as unresolved instead of inferring its false default', () => {
    const { cls, symbol } = sample(`export class Sample { constructor(closed = false) { this.closed = closed; } }`);
    const proof = proveJavaScriptDataProperty(cls, symbol);
    const assignment = proof.kind === 'data' ? proof.constructorAssignments[0] : undefined;

    expect(assignment && describeAssigned(assignedValue(assignment.getRight(), resolvedField(cls, 'closed')))).toEqual({ tokens: [], unresolved: true, mayWrite: false });
  });

  it('keeps the original parameter identifier as constructor evidence', () => {
    const { cls, symbol } = sample(`export class Sample { constructor(closed = false) { this.closed = closed; } }`);
    const proof = proveJavaScriptDataProperty(cls, symbol);
    const parameter = cls.getConstructors()[0]?.getParameters()[0];

    expect(proof.kind === 'data' ? proof.constructorAssignments[0]?.getRight().getSymbol() : undefined).toBe(parameter?.getSymbol());
  });

  it.each([
    `const closed = false; export class Sample { constructor(value = false) { this.closed = closed; } }`,
    `export class Sample { constructor(closed = false) { const value = closed; this.closed = value; } }`,
    `export class Sample { constructor(closed = false) { { const closed = true; this.closed = closed; } } }`,
    `export class Sample { constructor(closed = false) { closed = true; this.closed = closed; } }`,
    `export class Sample { constructor(closed = makeValue()) { this.closed = closed; } }`,
    `export class Sample { constructor(closed = false) { this.closed = makeValue(closed); } }`,
    `export class Sample { constructor(closed = false) { (() => { this.closed = closed; })(); } }`,
    `export class Sample { constructor({ closed } = {}) { this.closed = closed; } }`,
    `export class Sample { constructor(...closed) { this.closed = closed; } }`,
    `class Base { constructor(closed = false) { this.closed = closed; } } export class Sample extends Base { constructor(closed = false) { super(makeValue(closed)); } }`,
    `class Base { constructor(closed = false) { this.closed = closed; } } export class Sample extends Base { constructor(closed = false) { super(...[closed]); } }`,
    `class Base { get closed() { return false; } set closed(value) {} } export class Sample extends Base { constructor(closed = false) { super(); this.closed = closed; } }`,
  ])('keeps unproven parameter construction unknown in %s', (source) => {
    const { cls, symbol } = sample(source);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });
});

describe('JavaScript setter backing data', () => {
  it('proves the already constructed slot written by a transparent setter', () => {
    const { cls, symbol } = sample(`export class Sample {
      constructor() { this.closed = false; }
      get state() { return this.closed; }
      set state(value) { this.closed = value; }
    }`);

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('data');
  });

  it('does not treat setter stores as construction evidence', () => {
    const { cls, symbol } = sample(`export class Sample {
      constructor() { this.closed = false; }
      get state() { return this.closed; }
      set state(value) { this.closed = value; }
    }`);
    const proof = proveJavaScriptDataProperty(cls, symbol);

    expect(proof.kind === 'data' ? proof.constructorAssignments.map(assignment => assignment.getText()) : proof.kind).toEqual(['this.closed = false']);
  });

  it('requires construction even when a setter assigns the slot', () => {
    const { cls, symbol } = sample('export class Sample { set state(value) { this.closed = value; } }');

    expect(proveJavaScriptDataProperty(cls, symbol).kind).toBe('unknown');
  });
});
