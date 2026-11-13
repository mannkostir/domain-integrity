import { Node, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { proveJavaScriptDataProperty } from '../../../src/analyzers/lifecycle/javascript-data';
import { inMemoryProject } from '../../helpers/in-memory';

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
