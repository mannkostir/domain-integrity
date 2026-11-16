import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const base = `export class Order {
  closed = false; label = '';
  private buffer: object[] = [];
  protected record(payload: object) { this.buffer.push(payload); }
  isClosed() { return false; }
  rename() { if (this.isClosed()) return; this.label = 'changed'; }
  unguarded() { this.label = 'unguarded'; }
  notify() { this.record({ kind: 'safe' }); }
}`;
const declarations = 'interface Receiver { record(payload: { nested: object }): void; } declare const receiver: Receiver; declare const payload: object;';
const source = (body: string, prefix = '') => `${base}\n${declarations}\n${prefix}\nexport function trigger() { ${body} }`;
const variants = [
  { name: 'direct Reflect.get', body: "Reflect.get(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'aliased Reflect.get', prefix: 'const read = Reflect.get;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'renamed operation alias', prefix: 'const read = Reflect.get; const invoke = read;', body: "invoke(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'globalThis owner', body: "globalThis.Reflect.get(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'literal operation selector', body: "Reflect['get'](receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'erased function alias', prefix: 'const read: Function = Reflect.get;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'erased unknown alias', prefix: 'const read: unknown = Reflect.get;', body: "(read as typeof Reflect.get)(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'bound operation', prefix: 'const read = Reflect.get.bind(Reflect);', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'stored operation', prefix: 'const operations = { read: Reflect.get };', body: "operations.read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'returned operation', prefix: 'function provide() { return Reflect.get; }', body: "provide()(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'owner alias', prefix: 'const api = Reflect;', body: "api.get(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'erased owner', prefix: 'const api: unknown = Reflect;', body: "(api as typeof Reflect).get(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'destructured operation', prefix: 'const { get: read } = Reflect;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'operation call', body: "Reflect.get.call(undefined, receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'operation apply', body: "Reflect.get.apply(undefined, [receiver, 'record']).call(receiver, { nested: payload });" },
  { name: 'Object prototype descriptor', body: "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(receiver), 'record')!.value.call(receiver, { nested: payload });" },
  { name: 'Reflect prototype descriptor', body: "Reflect.getOwnPropertyDescriptor(Reflect.getPrototypeOf(receiver)!, 'record')!.value.call(receiver, { nested: payload });" },
  { name: 'aliased descriptor', prefix: 'const descriptor = Object.getOwnPropertyDescriptor; const prototype = Object.getPrototypeOf;', body: "descriptor(prototype(receiver), 'record')!.value.call(receiver, { nested: payload });" },
  { name: 'unknown key', prefix: 'declare const key: string;', body: 'Reflect.get(receiver, key).call(receiver, { nested: payload });' },
  { name: 'opaque receiver', prefix: 'declare const target: object;', body: "Reflect.get(target, 'record').call(receiver, { nested: payload });" },
  { name: 'operation exposure', prefix: 'declare function consume(value: unknown): void;', body: 'consume(Reflect.get);' },
  { name: 'owner exposure', prefix: 'declare function consume(value: unknown): void;', body: 'consume(Reflect);' },
  { name: 'Object owner exposure', prefix: 'declare function consume(value: unknown): void;', body: 'consume(Object);' },
  { name: 'descriptor collection', body: 'Object.getOwnPropertyDescriptors(receiver);' },
  { name: 'prototype acquisition', body: 'Object.getPrototypeOf(receiver);' },
  { name: 'reflect prototype acquisition', body: 'Reflect.getPrototypeOf(receiver);' },
  { name: 'key enumeration', body: 'Reflect.ownKeys(receiver);' },
  { name: 'unused operation exposure', prefix: 'const read = Reflect.get;', body: '' },
  { name: 'unknown API function', prefix: 'declare const read: (...args: unknown[]) => any;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'unknown API any', prefix: 'declare const read: any;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'unknown API Function', prefix: 'declare const read: Function;', body: "read.call(undefined, receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'bodyless API', prefix: 'declare function read(target: object, key: string): any;', body: "read(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'opaque member API', prefix: 'interface API { lookup(target: object, key: string): { call(receiver: Receiver, value: { nested: object }): void }; } declare const api: API;', body: "api.lookup(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'public member API body', prefix: 'class API { lookup(_target: object, _key: string): { call(receiver: Receiver, value: { nested: object }): void } { return { call(_receiver: Receiver, _value: { nested: object }) {} }; } } declare const api: API;', body: "api.lookup(receiver, 'record').call(receiver, { nested: payload });" },
  { name: 'benign genuine Object call', body: "Object.is('left', 'right');" },
  { name: 'borrowed lexical this API', prefix: "class Borrower { lookup(_target: object, _key: string): { call(owner: Receiver, value: { nested: object }): void } { return { call(_owner: Receiver, _value: { nested: object }) {} }; } run() { this.lookup(receiver, 'record').call(receiver, { nested: payload }); } }", body: '' },
  { name: 'opaque discarded invocation', prefix: 'interface API { perform(target: object, value: { nested: object }): void; } declare const api: API;', body: 'api.perform(receiver, { nested: payload });' },
  { name: 'opaque getter read', prefix: 'interface API { readonly value: number; } declare const api: API;', body: 'void api.value;' },
  { name: 'opaque constructor', prefix: 'declare class API { constructor(target: object, value: { nested: object }); }', body: 'new API(receiver, { nested: payload });' },
  { name: 'uninvoked callable exposure', prefix: 'declare const api: () => void;', body: 'const exposed = api; void exposed;' },
  { name: 'uninvoked nested container exposure', prefix: 'declare const api: { nested: { invoke(): void } };', body: 'const exposed = api; void exposed;' },
];

const analyze = (text: string, project = inMemoryProject({ '/order.ts': text }), configFile?: ReturnType<typeof project.getSourceFile>, runtimePaths: readonly string[] = ['/order.ts']) => {
  const target = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, eventMethods: ['record'], lifecycles: [{ target, fields: [{ name: 'closed', terminal: ['true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: runtimePaths.map(path => project.getSourceFileOrThrow(path)), configFile, projectRoot: '/', repositoryRoot: '/',
  });
  return { project, problems: model.problems, sources: describeSources(model.aggregates[0]!.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources), findings: lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method) };
};

describe('reflective API exposure closes literal payload origins', () => {
  it.each(variants)('uses diagnostic-free source for $name', fixture => {
    expect(analyze(source(fixture.body, fixture.prefix)).project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });
  it.each(variants)('has no extraction problems for $name', fixture => {
    expect(analyze(source(fixture.body, fixture.prefix)).problems).toEqual([]);
  });
  it.each(variants)('declines the origin exception for $name', fixture => {
    expect(analyze(source(fixture.body, fixture.prefix)).sources).toBe('unknown');
  });
  it.each(variants)('keeps the guarded method silent for $name', fixture => {
    expect(analyze(source(fixture.body, fixture.prefix)).findings).not.toContain('rename');
  });
  it.each(variants)('retains the unguarded finding for $name', fixture => {
    expect(analyze(source(fixture.body, fixture.prefix)).findings).toContain('unguarded');
  });
  it('keeps the safe literal-only helper precise', () => {
    expect(analyze(base).sources).toEqual(['false', 'true']);
  });
  it('declines an unproved project Reflect operation', () => {
    expect(analyze(source("Reflect.get({ value: 1 }, 'value');", 'const Reflect = { get(_target: object, _key: string) { return 0; } };')).sources).toBe('unknown');
  });
  it('declines an unproved project Object operation', () => {
    expect(analyze(source("Object.is('left', 'right');", 'const Object = { is(_left: string, _right: string) { return false; } };')).sources).toBe('unknown');
  });
  it('rebuilds reflection facts after add remove and readd', () => {
    const project = inMemoryProject({ '/order.ts': base });
    const file = project.getSourceFileOrThrow('/order.ts');
    const actual = [analyze('', project).sources];
    for (const text of [source(variants[0]!.body), base, source(variants[1]!.body, variants[1]!.prefix)]) {
      file.replaceWithText(text);
      actual.push(analyze('', project).sources);
    }

    expect(actual).toEqual([['false', 'true'], 'unknown', ['false', 'true'], 'unknown']);
  });
  it('excludes static config by actual SourceFile identity', () => {
    const project = inMemoryProject({ '/order.ts': base, '/domain.config.ts': `${declarations} Reflect.get(receiver, 'record').call(receiver, { nested: payload }); throw new Error('never execute');` });
    const configFile = project.getSourceFileOrThrow('/domain.config.ts');

    expect([analyze('', project, configFile, ['/order.ts', '/domain.config.ts']).sources, analyze('', project, undefined, ['/order.ts', '/domain.config.ts']).sources]).toEqual([['false', 'true'], 'unknown']);
  });
});


describe('aggregate data paths do not certify callable exposure', () => {
  it.each([
    'callback = () => {}; expose() { const stored = this.callback; }',
    'container = { invoke() {} }; expose() { const stored = this.container; }',
  ])('declines data capability storage for %s', member => {
    const result = analyze(base.replace('closed = false;', `${member} closed = false;`));

    expect([result.project.getPreEmitDiagnostics().length, result.problems, result.sources, result.findings.includes('rename'), result.findings.includes('unguarded')]).toEqual([0, [], 'unknown', false, true]);
  });
});
