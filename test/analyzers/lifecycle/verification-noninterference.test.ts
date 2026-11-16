import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';
import { describeSources } from '../../helpers/describe';

const inert = (argument: string, wrap = (call: string) => call, before = '', member = '') => {
  const project = inMemoryProject({
    '/library.d.ts': 'export declare class Base { allowed(value: unknown, ...rest: unknown[]): boolean; }',
    '/order.ts': `import { Base } from './library'; export class Order extends Base {
      status: 'open' | 'closed' = 'open'; label = ''; ${member}
      rename(policy: { closed(): boolean }) { ${before} if (${wrap(`this.allowed(${argument})`)}) return; this.label = 'changed'; }
      unguarded() { this.label = 'unguarded'; }
    }`,
  });
  const target = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, inertMembers: ['allowed'], lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates[0]!;
  return { project, problems: model.problems, sources: describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('status')!.sources), findings: lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method) };
};

const unsafeArguments = [
  { name: 'foreign call', value: 'policy.closed()' },
  { name: 'Boolean local alias', value: 'gate', before: 'const gate = policy.closed();' },
  { name: 'literal true local alias', value: 'literalGate', before: "const literalGate: true = policy.closed() ? true : (() => { throw new Error('not closed'); })();" },
  { name: 'asserted foreign call', value: '(policy.closed() as true)' },
  { name: 'annotated local alias', value: 'gate', before: 'const gate: boolean = policy.closed();' },
  { name: 'state read', value: "this.status === 'closed'" },
  { name: 'state write', value: "(this.status = 'closed') === 'closed'" },
  { name: 'callback', value: "() => this.status === 'closed'" },
  { name: 'unproved getter', value: 'this.flag', member: "get flag() { return this.status === 'closed'; }" },
  { name: 'unproved method', value: 'this.flag()', member: "flag() { return this.status === 'closed'; }" },
  { name: 'coercive argument', value: 'value == true', before: 'const value: unknown = policy.closed();' },
  { name: 'primitive parameter', value: 'policy', before: '' },
  { name: 'late unsupported argument', value: 'false, policy.closed()' },
  { name: 'early unsupported argument', value: 'policy.closed(), false' },
  { name: 'safe-looking literal alias', value: 'gate', before: 'const gate = false;' },
];
const consumers = [
  { name: 'direct', wrap: (call: string) => call },
  { name: 'negated', wrap: (call: string) => `!${call}` },
  { name: 'strict equality', wrap: (call: string) => `${call} === true` },
  { name: 'conjunction', wrap: (call: string) => `${call} && true` },
  { name: 'disjunction', wrap: (call: string) => `false || ${call}` },
];
const inertCases = unsafeArguments.flatMap(argument => consumers.map(consumer => ({ ...argument, ...consumer, name: `${argument.name} in ${consumer.name}` })));

describe('inert call arguments preserve unsupported guard dependencies', () => {
  it.each(inertCases)('uses diagnostic-free source for $name', fixture => {
    expect(inert(fixture.value, fixture.wrap, fixture.before, fixture.member).project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });
  it.each(inertCases)('keeps $name unknown', fixture => {
    expect(inert(fixture.value, fixture.wrap, fixture.before, fixture.member).sources).toBe('unknown');
  });
  it.each(inertCases)('retains the unguarded finding beside $name', fixture => {
    expect(inert(fixture.value, fixture.wrap, fixture.before, fixture.member).findings).toContain('unguarded');
  });
  it.each(['false', '(false)', 'true', '0', "'literal'", 'null'])('retains literal argument %s compatibility', argument => {
    expect(inert(argument).findings).toContain('rename');
  });
});

const base = `export class Order {
  closed = false; label = '';
  private buffer: object[] = [];
  protected record(payload: object) { this.buffer.push(payload); }
  isClosed() { return false; }
  rename() { if (this.isClosed()) return; this.label = 'changed'; }
  unguarded() { this.label = 'unguarded'; }
  notify() { this.record({ kind: 'safe' }); }
}`;
const receiverCases = [
  { name: 'interface dot', shape: 'interface Receiver { record(payload: { nested: object }): void; }', receiver: 'receiver', selector: '.record' },
  { name: 'interface literal element', shape: 'interface Receiver { record(payload: { nested: object }): void; }', receiver: 'receiver', selector: "['record']" },
  { name: 'public class', shape: 'class Receiver { record(payload: { nested: object }): void {} }', receiver: 'receiver', selector: '.record' },
  { name: 'returned interface', shape: 'interface Receiver { record(payload: { nested: object }): void; }', receiver: 'getReceiver()', selector: '.record' },
  { name: 'returned class', shape: 'class Receiver { record(payload: { nested: object }): void {} }', receiver: 'getReceiver()', selector: '.record' },
  { name: 'type alias', shape: 'type Receiver = { record(payload: { nested: object }): void };', receiver: 'receiver', selector: '.record' },
  { name: 'union', shape: 'type Receiver = { record(payload: { nested: object }): void } | { record(payload: object): void };', receiver: 'receiver', selector: '.record' },
  { name: 'intersection', shape: 'type Receiver = { record(payload: { nested: object }): void } & { tag: string };', receiver: 'receiver', selector: '.record' },
  { name: 'generic', shape: 'interface Receiver { record(payload: { nested: object }): void; }', receiver: 'receiver', selector: '.record', generic: '<T extends Receiver>', parameter: 'receiver: T' },
  { name: 'member mask', shape: 'interface Receiver { record(payload: { nested: object }): void; } declare const holder: { target: Receiver };', receiver: 'holder.target', selector: '.record' },
  { name: 'dynamic', shape: 'type Receiver = { [key: string]: (payload: { nested: object }) => void }; declare const key: string;', receiver: 'receiver', selector: '[key]' },
  { name: 'erased unknown', shape: 'type Receiver = unknown;', receiver: '(receiver as { record(payload: object): void })', selector: '.record' },
  { name: 'any', shape: 'type Receiver = any;', receiver: 'receiver', selector: '.record' },
];
const maskSource = (fixture: typeof receiverCases[number], unsafeFirst = false) => {
  const extra = `${fixture.shape} declare const receiver: Receiver; declare const payload: object;
    declare function getReceiver(): Receiver;
    export function trigger${fixture.generic ?? ''}(${fixture.parameter ?? ''}) { ${fixture.receiver}${fixture.selector}({ nested: payload }); }`;
  return unsafeFirst ? `${extra}\n${base}` : `${base}\n${extra}`;
};
const masked = (text: string, project = inMemoryProject({ '/order.ts': text }), configFile?: ReturnType<typeof project.getSourceFile>, runtimePaths: readonly string[] = ['/order.ts']) => {
  const target = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, eventMethods: ['record'], lifecycles: [{ target, fields: [{ name: 'closed', terminal: ['true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: runtimePaths.map(path => project.getSourceFileOrThrow(path)), configFile, projectRoot: '/', repositoryRoot: '/',
  });
  return { project, problems: model.problems, sources: describeSources(model.aggregates[0]!.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources), findings: lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method) };
};

describe('helper selectors cannot exclude structural receiver masks', () => {
  it.each(receiverCases)('uses diagnostic-free $name source', fixture => {
    expect(masked(maskSource(fixture)).project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });
  it.each(receiverCases)('keeps $name sources unknown', fixture => {
    expect(masked(maskSource(fixture)).sources).toBe('unknown');
  });
  it.each(receiverCases)('keeps $name guarded findings silent', fixture => {
    expect(masked(maskSource(fixture)).findings).not.toContain('rename');
  });
  it.each(receiverCases)('retains the unguarded finding beside $name', fixture => {
    expect(masked(maskSource(fixture)).findings).toContain('unguarded');
  });
  it.each(receiverCases)('rejects $name before the safe caller too', fixture => {
    expect(masked(maskSource(fixture, true)).sources).toBe('unknown');
  });
  it('retains the safe literal-only positive', () => {
    expect(masked(base).sources).toEqual(['false', 'true']);
  });
  it('recovers and rejects masks across fresh extraction after AST edits', () => {
    const project = inMemoryProject({ '/order.ts': base });
    const file = project.getSourceFileOrThrow('/order.ts');
    const actual = [masked('', project).sources];
    for (const text of [maskSource(receiverCases[0]!), base, maskSource(receiverCases[0]!)]) {
      file.replaceWithText(text);
      actual.push(masked('', project).sources);
    }

    expect(actual).toEqual([['false', 'true'], 'unknown', ['false', 'true'], 'unknown']);
  });
  it('excludes the identical static configuration by actual file identity', () => {
    const project = inMemoryProject({ '/order.ts': base, '/domain.config.ts': "import { Order } from './order'; interface Receiver { record(payload: { nested: object }): void; } declare const receiver: Receiver; declare const payload: object; receiver.record({ nested: payload }); throw new Error('never execute');" });
    const configFile = project.getSourceFileOrThrow('/domain.config.ts');

    expect([masked('', project, configFile, ['/order.ts', '/domain.config.ts']).sources, masked('', project, undefined, ['/order.ts', '/domain.config.ts']).sources]).toEqual([['false', 'true'], 'unknown']);
  });
});

describe('inert argument proof limits', () => {
  it('keeps deep literal arguments unknown at the shared depth limit', () => {
    expect(inert('((((((false))))))').sources).toBe('unknown');
  });
  it('keeps an exhausted literal argument root unknown', () => {
    expect(inert(Array.from({ length: 260 }, () => 'false').join(', ')).sources).toBe('unknown');
  });
  it('cannot recover a failed argument from a safe Boolean branch', () => {
    expect(inert('policy.closed()', call => `${call} || this.allowed(false)`).sources).toBe('unknown');
  });
  it('retains safe literal arguments through strict comparison', () => {
    expect(inert('false', call => `${call} === true`).findings).toContain('rename');
  });
  it('leaves a direct foreign-policy guard unknown', () => {
    expect(inert('false', () => 'policy.closed()').sources).toBe('unknown');
  });
});

describe('different helper selector boundaries', () => {
  it.each(['receiver.different', "receiver['different']"])('declines opaque invocation through the distinct slot %s', selector => {
    const text = `${base} interface Receiver { different(value: object): void; } declare const receiver: Receiver;
      declare const payload: object; export function trigger() { ${selector}({ nested: payload }); }`;

    expect(masked(text).sources).toBe('unknown');
  });
  it('declines even a fresh public class when its same-named slot identity is unproved', () => {
    const text = `${base} class Receiver { record(value: object): void {} }
      const receiver = new Receiver(); declare const payload: object; receiver.record({ nested: payload });`;

    expect(masked(text).sources).toBe('unknown');
  });
});


describe('affirmatively distinct primitive selectors', () => {
  it.each(['Other.different', "Other['different']"])('retains the actual primitive enum selector %s', selector => {
    const text = `${base} enum Other { different = 1 } export const value = ${selector};`;
    const result = masked(text);

    expect([result.project.getPreEmitDiagnostics().length, result.sources, result.findings.includes('rename'), result.findings.includes('unguarded')]).toEqual([0, ['false', 'true'], true, true]);
  });
});
