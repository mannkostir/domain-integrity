import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { analysedSourceFiles, loadProject } from '../../../src/engine/project';
import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';
import { projectIndex } from '../../../src/analyzers/lifecycle/project-index';
import { aggregateScope } from '../../../src/analyzers/lifecycle/scope';

const source = (caller = "this.record({ kind: 'changed' });", helper = 'protected record(payload: object) { this.buffer.push(payload); }', extra = '') => `
export abstract class Root<P extends object> {
  protected props!: P;
  private buffer: object[] = [];
  ${helper}
}
export class Order extends Root<{ closed: boolean }> {
  label = '';
  private get isClosed() { return this.props.closed; }
  rename() { if (this.isClosed) return; this.label = 'renamed'; }
  unguarded() { this.label = 'unguarded'; }
  notify() { ${caller} }
}
${extra}`;

const inspect = (text: string, extra: Readonly<Record<string, string>> = {}, excluded: readonly string[] = [], existingProject?: ReturnType<typeof inMemoryProject>, runtimePaths: readonly string[] = ['/order.ts', ...Object.keys(extra)]) => {
  const project = existingProject ?? inMemoryProject({ '/order.ts': text, ...extra });
  const files = runtimePaths.filter(path => !excluded.includes(path)).map(path => project.getSourceFileOrThrow(path));
  const target = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const declaration = { ...DEFAULT_DECLARATION, eventMethods: ['record'], lifecycles: [{ target, fields: [{ name: 'closed', terminal: ['true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] };
  const scope = aggregateScope(target, declaration, projectIndex(files));
  const model = extractLifecycles({ declaration, files, projectRoot: '/', repositoryRoot: '/' });
  const aggregate = model.aggregates.find(aggregate => aggregate.name === 'Order')!;
  return { project, files, stable: scope.scalarCallables.stable(target), sources: describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources), findings: terminalStateLeak(aggregate).map(finding => finding.details.method) };
};

const positives = [
  ['fresh record', source()],
  ['two literal callers', source("this.record({ kind: 'one' }); this.record({ nested: { ok: true, value: null } });")],
  ['renamed helper and buffer', source().replaceAll('record', 'collect').replaceAll('buffer', 'queue')],
] as const;

const unsafeArguments = [
  ['aggregate', 'this'], ['nominal local', 'instance'], ['erased object', 'erased'], ['unknown view', 'unknownView'],
  ['ambient object', 'ambient'], ['ambient unknown', 'uncertain'], ['nested receiver', '{ target: this }'],
  ['receiver factory', 'make()'], ['class', 'Order'], ['enum', 'State'], ['operation namespace', 'Object'],
  ['call', 'opaque()'], ['getter', 'this.payload'], ['literal variable', 'literal'], ['identifier member', '{ kind: literal }'],
  ['computed key', "{ ['kind']: 'x' }"], ['prototype key', '{ __proto__: null }'], ['spread', "{ ...{ kind: 'x' } }"],
  ['shorthand', '{ literal }'], ['method', '{ kind() { return true; } }'], ['accessor', '{ get kind() { return true; } }'],
  ['assertion', "({ kind: 'x' } as object)"], ['new', 'new Date()'], ['array', "['x']"],
] as const;
const declarationsFor = (argument: string): string => [
  argument === 'instance' ? 'const instance = new Order();' : '',
  argument === 'erased' ? 'const erased: object = new Order();' : '',
  argument === 'unknownView' ? 'const unknownView: unknown = new Order();' : '',
  argument === 'ambient' ? 'declare const ambient: object;' : '',
  argument === 'uncertain' ? 'declare const uncertain: unknown;' : '',
  argument === 'make()' ? 'function make() { return new Order(); }' : '',
  argument === 'opaque()' ? 'declare function opaque(): object;' : '',
  argument === 'State' ? 'enum State { Open, Closed }' : '',
  argument.includes('literal') ? "const literal = { kind: 'x' };" : '',
].join('\n');

const unsafeShapes = [
  ['no caller', source('')], ['optional call', source("this.record?.({ kind: 'x' });")],
  ['spread call', source("this.record(...[{ kind: 'x' }]);")], ['computed call', source("this['record']({ kind: 'x' });")],
  ['dynamic call', source("declareKey; this[declareKey]({ kind: 'x' });", undefined, 'declare const declareKey: string;')],
  ['bound helper', source("this.record.bind(this)({ kind: 'x' });")], ['extracted helper', source('const f = this.record;')],
  ['destructured helper', source('const { record } = this;')], ['replaced helper', source("this.record = () => {}; this.record({ kind: 'x' });")],
  ['public helper', source(undefined, 'record(payload: object) { this.buffer.push(payload); }')],
  ['default parameter', source(undefined, "protected record(payload: object = {}) { this.buffer.push(payload); }")],
  ['optional parameter', source(undefined, 'protected record(payload?: object) { this.buffer.push(payload); }')],
  ['rest parameter', source(undefined, 'protected record(payload: object, ...rest: object[]) { this.buffer.push(payload); }')],
  ['generic helper', source(undefined, 'protected record<T>(payload: object) { this.buffer.push(payload); }')],
  ['overloaded helper', source(undefined, 'protected record(payload: object): void; protected record(payload: object) { this.buffer.push(payload); }')],
  ['reassigned parameter', source(undefined, 'protected record(payload: object) { payload = {}; this.buffer.push(payload); }')],
  ['captured parameter', source(undefined, 'protected record(payload: object) { const f = () => payload; this.buffer.push(payload); }')],
  ['extra use', source(undefined, 'protected record(payload: object) { this.buffer.push(payload, payload); }')],
  ['extra statement', source(undefined, 'protected record(payload: object) { 1; this.buffer.push(payload); }')],
  ['unresolved caller', source(undefined, undefined, "declare const receiver: any; receiver.record({ kind: 'x' });")],
  ['unresolved dynamic receiver', source(undefined, undefined, "declare const receiver: any; declare const key: string; receiver[key]({ kind: 'x' });")],
  ['missing caller argument', source('this.record();')], ['extra caller argument', source("this.record({ kind: 'x' }, {});")],
  ['override', source(undefined, undefined, 'class Other extends Root<object> { protected record(payload: object) {} }')],
  ['shadow', source(undefined, undefined, 'class Other extends Root<object> { protected record = (payload: object) => {}; }')],
  ['forwarded parameter', source('this.forward({ kind: "x" });').replace('notify() {', 'forward(payload: object) { this.record(payload); } notify() {')],
  ['depth exhausted', source('this.record({ a: { b: { c: { d: { e: { f: true } } } } } });')],
  ['work exhausted', source(`this.record({ ${Array.from({ length: 260 }, (_, index) => `p${index}: true`).join(',')} });`)],
] as const;

describe('bounded literal payload origins', () => {
  it.each(positives)('restores precise guarded sources for %s', (_name, text) => {
    expect(inspect(text).sources).toEqual(['false']);
  });
  it('proves dispatch for a closed helper', () => {
    expect(inspect(source()).stable).toBe(true);
  });
  it('retains the deliberate unguarded finding', () => {
    expect(inspect(source()).findings).toContain('unguarded');
  });
  it.each(unsafeArguments)('rejects %s among otherwise safe callers', (_name, argument) => {
    expect(inspect(source(`this.record({ kind: 'safe' }); this.record(${argument});`, undefined, declarationsFor(argument)).replace('label =', "private get payload() { return { kind: 'opaque' }; } label =")).sources).toBe('unknown');
  });
  it.each(unsafeShapes)('rejects the incomplete helper shape %s', (_name, text) => {
    expect(inspect(text).sources).toBe('unknown');
  });
  it.each(unsafeShapes)('retains the unguarded finding beside %s', (_name, text) => {
    expect(inspect(text).findings).toContain('unguarded');
  });
  it('does not exempt a direct ambient broad argument', () => {
    expect(inspect(source('', '', 'declare const ambient: object; declare function opaque(value: object): void; opaque(ambient);')).sources).toBe('unknown');
  });
  it('keeps excluded configuration out of the runtime use set', () => {
    expect(inspect(source(), { '/domain.config.ts': "throw new Error('not executed'); import { Order } from './order'; const order = new Order(); order['record'](order);" }, ['/domain.config.ts']).sources).toEqual(['false']);
  });
  it('rejects the identical unsafe configuration when supplied as runtime evidence', () => {
    expect(inspect(source(), { '/domain.config.ts': "throw new Error('not executed'); import { Order } from './order'; const order = new Order(); order['record'](order);" }).sources).toBe('unknown');
  });
});

const actualEnum = () => {
  const root = fileURLToPath(new URL('../../fixtures/enum-inline/', import.meta.url));
  const configPath = join(root, 'domain.config.ts');
  const project = loadProject(join(root, 'tsconfig.json'), configPath, root);
  const files = analysedSourceFiles(project, project.getSourceFile(configPath));
  const target = project.getSourceFileOrThrow(join(root, 'src/order.ts')).getClassOrThrow('Order');
  const declaration = { ...DEFAULT_DECLARATION, lifecycles: [{ target, fields: [{ name: 'status', terminal: ['CANCELLED'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] };
  const model = extractLifecycles({ declaration, files, projectRoot: root, repositoryRoot: root });
  return { files, target, scope: aggregateScope(target, declaration, projectIndex(files)), aggregate: model.aggregates[0]! };
};

describe('actual enum-inline runtime sources', () => {
  it('uses exactly three runtime files with configuration excluded', () => {
    expect(actualEnum().files.map(file => file.getBaseName()).sort()).toEqual(['aggregate-root.ts', 'order-status.ts', 'order.ts']);
  });
  it('restores stable dispatch', () => {
    const { scope, target } = actualEnum();

    expect(scope.scalarCallables.stable(target)).toBe(true);
  });
  it.each(['addLine', 'confirm'])('restores PENDING sources for %s', name => {
    expect(describeSources(actualEnum().aggregate.methods.find(method => method.name === name)!.fields.get('status')!.sources)).toEqual(['PENDING']);
  });
  it('retains the CONFIRMED assignment', () => {
    expect([...actualEnum().aggregate.methods.find(method => method.name === 'confirm')!.fields.get('status')!.sets.tokens]).toEqual(['CONFIRMED']);
  });
  it.each(positives)('uses diagnostic-free positive source for %s', (_name, text) => {
    expect(inspect(text).project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });
  it.each(unsafeArguments)('retains the unguarded finding for the %s origin', (_name, argument) => {
    expect(inspect(source(`this.record({ kind: 'safe' }); this.record(${argument});`, undefined, declarationsFor(argument)).replace('label =', "private get payload() { return { kind: 'opaque' }; } label =")).findings).toContain('unguarded');
  });
  it.each([false, true])('rejects unsafe caller order reversed=%s', reversed => {
    const calls = ["this.record({ kind: 'safe' });", 'this.record(ambient);'];
    if (reversed) calls.reverse();

    expect(inspect(source(calls.join(' '), undefined, 'declare const ambient: object;')).sources).toBe('unknown');
  });
});

it('rebuilds origin evidence after unsafe caller addition removal and readdition', () => {
  const project = inMemoryProject({ '/order.ts': source() });
  const file = project.getSourceFileOrThrow('/order.ts');
  const current = () => inspect('', {}, [], project).sources;
  const unsafe = source("this.record({ kind: 'safe' }); this.record(ambient);", undefined, 'declare const ambient: object;');
  const actual = [current()];
  file.replaceWithText(unsafe);
  actual.push(current());
  file.replaceWithText(source());
  actual.push(current());
  file.replaceWithText(unsafe);
  actual.push(current());

  expect(actual).toEqual([['false'], 'unknown', ['false'], 'unknown']);
});


describe('authored runtime input boundaries', () => {
  it('indexes only the explicitly authored aggregate', () => {
    expect(inspect(source()).files.map(file => file.getFilePath())).toEqual(['/order.ts']);
  });
  it('keeps the same Project conservative when injected infrastructure is explicitly runtime', () => {
    const project = inMemoryProject({ '/order.ts': source() });
    const precise = inspect('', {}, [], project, ['/order.ts']);
    const broad = inspect('', {}, [], project, project.getSourceFiles().map(file => file.getFilePath()));

    expect([precise.stable, precise.sources, precise.findings.includes('unguarded'), broad.stable, broad.sources, broad.findings.includes('unguarded')]).toEqual([true, ['false'], true, false, 'unknown', true]);
  });
  it('does not trust an ordinary authored generic container source', () => {
    const result = inspect(source(), { '/container.ts': 'export const preserve = <T extends object>(target: T) => ({ target });' });

    expect([result.project.getPreEmitDiagnostics().length, result.stable, result.sources, result.findings.includes('unguarded')]).toEqual([0, false, 'unknown', true]);
  });
  it('updates the explicit runtime set after hazard file add remove and readd', () => {
    const project = inMemoryProject({ '/order.ts': source() });
    const current = () => inspect('', {}, [], project, ['/order.ts', ...(project.getSourceFile('/hazard.ts') === undefined ? [] : ['/hazard.ts'])]).sources;
    const actual = [current()];
    const hazard = 'export const preserve = <T extends object>(target: T) => ({ target });';
    project.createSourceFile('/hazard.ts', hazard);
    actual.push(current());
    project.removeSourceFile(project.getSourceFileOrThrow('/hazard.ts'));
    actual.push(current());
    project.createSourceFile('/hazard.ts', hazard);
    actual.push(current());

    expect(actual).toEqual([['false'], 'unknown', ['false'], 'unknown']);
  });
});
