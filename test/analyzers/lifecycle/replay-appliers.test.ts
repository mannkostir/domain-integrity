import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { ConditionalCopies } from '../../../src/analyzers/shared/conditional-copies';
import { MemberMutations } from '../../../src/analyzers/shared/member-mutations';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const base = `
interface Event { eventName: string }
class AggregateRoot {
  protected applyChange(event: Event) { this.applyEvent(event, true); }
  private applyEvent(event: Event, isNew = false) {
    const handlerMethod = \`apply\${event.eventName}\`;
    if (typeof (this as any)[handlerMethod] === 'function') {
      (this as any)[handlerMethod](event);
    }
  }
  loadFromHistory(events: Event[]) {
    for (const event of events) { this.applyEvent(event); }
  }
}
`;

const events = `
class Created { eventName = Created.name; }
class Updated { eventName = Updated.name; }
class Archived { eventName = Archived.name; }
`;

const account = `
export class Account extends AggregateRoot {
  private status: 'active' | 'archived' = 'active';
  private title = '';
  updateInfo() { this.applyChange(new Updated()); }
  archive() {
    if (this.status === 'archived') throw new Error('archived');
    this.applyChange(new Archived());
  }
  applyCreated(event: Created) { this.title = 'created'; }
  applyUpdated(event: Updated) { this.title = 'updated'; }
  applyArchived(event: Archived) { this.status = 'archived'; }
}
`;

const extract = (source = account, root = base, extra = '', transitions?: ReadonlyMap<string, readonly string[]>, mappedBase = false, otherFiles: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({ ...(mappedBase ? {
    '/src/account.ts': "import { AggregateRoot } from '../dist/base';\n" + events + source + extra,
    '/src/base.ts': root.replace('class AggregateRoot', 'export class AggregateRoot'),
    '/dist/base.d.ts': 'export declare class AggregateRoot { protected applyChange(event: unknown): void; private applyEvent; loadFromHistory(events: unknown[]): void; }\n//# sourceMappingURL=base.d.ts.map',
  } : { '/src/account.ts': root + events + source + extra }), ...otherFiles });
  if (mappedBase) project.getFileSystem().writeFileSync('/dist/base.d.ts.map', JSON.stringify({ version: 3, sources: ['../src/base.ts'] }));
  const target = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('Account');
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['archived'], transitions, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: project.getSourceFiles().filter((file) => !file.isDeclarationFile()),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return model;
};

const leaks = (source = account, root = base, extra = '', otherFiles: Readonly<Record<string, string>> = {}) =>
  lifecycleAnalyzer.check(extract(source, root, extra, undefined, false, otherFiles)).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort();

const transformerFiles = (version = '0.5.1'): Readonly<Record<string, string>> => ({
  '/node_modules/class-transformer/package.json': JSON.stringify({ name: 'class-transformer', version, typings: './types/index.d.ts', main: './cjs/index.js' }),
  '/node_modules/class-transformer/types/index.d.ts': 'export declare function instanceToPlain<T>(value: T, options?: unknown): Record<string, any>; export declare class ClassTransformer { instanceToPlain(value: unknown): unknown; }',
});

const serializedAccount = "import { instanceToPlain } from 'class-transformer';\n" + account;
const serializedExtra = 'function serialize<T extends Event>(event: T) { const result = instanceToPlain(event); delete result.eventName; }';

const roles = (model: ReturnType<typeof extract>): readonly string[] =>
  model.aggregates[0]!.methods.filter((method) => method.name.startsWith('apply')).map((method) => method.entryPoint);

describe('public replay appliers', () => {
  it('do not report appliers reached by event dispatch and history replay', () => {
    expect(leaks()).toEqual([]);
  });

  it('keeps similarly named public commands judged without dispatch evidence', () => {
    expect(leaks(account, 'class AggregateRoot {}')).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('keeps similarly named commands with unrelated parameters judged', () => {
    const source = account.replace('  updateInfo()', "  applyDiscount(amount: number) { this.title = String(amount); }\n  updateInfo()");

    expect(leaks(source)).toEqual(['applyDiscount']);
  });

  it('keeps direct calls to an applier judged', () => {
    const source = account.replace('this.applyChange(new Updated())', 'this.applyUpdated(new Updated())');

    expect(leaks(source)).toEqual(['applyUpdated', 'updateInfo']);
  });

  it('keeps appliers called directly from outside the aggregate judged', () => {
    expect(leaks(account, base, 'new Account().applyArchived(new Archived());')).toEqual(['applyArchived']);
  });

  it('keeps an applier extracted as a method value judged', () => {
    expect(leaks(account, base, 'const applier = new Account().applyUpdated;')).toEqual(['applyUpdated']);
  });

  it('keeps literal bracket calls judged', () => {
    expect(leaks(account, base, "new Account()['applyCreated'](new Created());")).toEqual(['applyCreated']);
  });

  it('keeps destructured appliers judged', () => {
    expect(leaks(account, base, 'const { applyCreated } = new Account();')).toEqual(['applyCreated']);
  });

  it('recognises inherited dispatch across an intermediate class', () => {
    const root = base + 'class Intermediate extends AggregateRoot {}';

    expect(leaks(account.replace('extends AggregateRoot', 'extends Intermediate'), root)).toEqual([]);
  });

  it('does not use a dispatcher hidden by an override', () => {
    const source = account.replace('  updateInfo()', '  applyEvent(event: Event) {}\n  updateInfo()');

    expect(leaks(source)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not use replay hidden by an override', () => {
    const source = account.replace('  updateInfo()', '  loadFromHistory(events: Event[]) {}\n  updateInfo()');

    expect(leaks(source)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer replay from a loop over a different collection', () => {
    const root = base.replace('for (const event of events)', 'for (const event of [])');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer replay from a different argument', () => {
    const root = base.replace('this.applyEvent(event);', 'this.applyEvent({ eventName: "other" });');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer dispatch on a foreign receiver', () => {
    const root = base.replace('(this as any)[handlerMethod](event)', '(other as any)[handlerMethod](event)');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer dispatch in a nested function with foreign this', () => {
    const root = base.replace('(this as any)[handlerMethod](event);', 'function dispatch() { (this as any)[handlerMethod](event); }');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each([
    'constructor() { (this as any)[handlerMethod](event); }',
    'get invoke() { return (this as any)[handlerMethod](event); }',
    'set invoke(value: number) { (this as any)[handlerMethod](event); }',
    'invoke = (this as any)[handlerMethod](event);',
  ])('does not infer dispatch on a nested class instance: %s', (member) => {
    const root = base.replace('(this as any)[handlerMethod](event);', `class Foreign { ${member} }`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer dispatch from an arbitrary computed key', () => {
    const root = base.replace('`apply${event.eventName}`', 'keyFor(event)');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not infer dispatch from a reassignable key', () => {
    expect(leaks(account, base.replace('const handlerMethod', 'let handlerMethod'))).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('recognises an inline computed dispatch key', () => {
    const root = base.replace('(this as any)[handlerMethod](event)', '(this as any)[`apply${event.eventName}`](event)');

    expect(leaks(account, root)).toEqual([]);
  });

  it('keeps a method judged when the event discriminator is overwritten', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "class Reassigned { eventName = 'Archived'; constructor() { this.eventName = 'Other'; } }";

    expect(leaks(source, base, extra)).toEqual(['applyArchived']);
  });

  it('does not treat an overridden class name as the event key', () => {
    const source = account.replace('event: Archived', 'event: RenamedEvent');
    const extra = "class RenamedEvent { static name = 'Other'; eventName = RenamedEvent.name; }";

    expect(leaks(source, base, extra)).toEqual(['applyArchived']);
  });

  it('retains assignments made by replay appliers', () => {
    const model = extract();
    const applier = model.aggregates[0]!.methods.find((method) => method.name === 'applyArchived')!;

    expect([...applier.fields.get('status')!.sets.tokens]).toEqual(['archived']);
  });

  it('does not judge replay appliers against declared transitions', () => {
    const model = extract(account, base, '', new Map([['applyArchived', ['active']]]));

    expect(lifecycleAnalyzer.check(model)).toEqual([]);
  });

  it('does not seed command transitions from replay appliers', () => {
    const model = extract();

    expect(suggestLifecycles({ ...model, aggregates: model.aggregates.map((aggregate) => ({ ...aggregate, declared: false })) })[0]!.fields[0]!.transitions).toEqual({ kind: 'none' });
  });

  it('recognises dispatch in an explicitly mapped workspace source', () => {
    const model = extract(account, base, '', undefined, true);

    expect(lifecycleAnalyzer.check(model)).toEqual([]);
  });

  it.each(['applyEvent', 'loadFromHistory'])('does not use a replaced mapped source method: %s', (name) => {
    const root = base.replace('  protected applyChange', `  constructor() { this.${name} = () => {}; }\n  protected applyChange`);
    const model = extract(account, root, '', undefined, true);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each(['applyEvent', 'loadFromHistory'])('rejects constructor bulk replacement of %s', (name) => {
    const root = base.replace('  protected applyChange', `  constructor() { Object.assign(this, { ${name}: () => {} }); }\n  protected applyChange`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each(['applyEvent', 'loadFromHistory'])('rejects mapped source bulk replacement of %s', (name) => {
    const root = base.replace('  protected applyChange', `  replace() { Object.assign(this, { ${name}: () => {} }); }\n  protected applyChange`);
    const model = extract(account, root, '', undefined, true);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects a bulk-replaced event discriminator', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "class Reassigned { eventName = 'Archived'; constructor() { Object.assign(this, { eventName: 'Other' }); } }";

    expect(leaks(source, base, extra)).toEqual(['applyArchived']);
  });

  it('rejects an externally bulk-replaced event discriminator', () => {
    expect(leaks(account, base, "Object.assign(new Archived(), { eventName: 'Other' });"))
      .toEqual(['applyArchived']);
  });

  it('keeps ordinary commands judged beside a replaced dispatcher', () => {
    const source = account.replace('  updateInfo()', "  applyDiscount(amount: number) { this.title = String(amount); }\n  updateInfo()");
    const root = base.replace('  protected applyChange', '  constructor() { Object.assign(this, { applyEvent: () => {} }); }\n  protected applyChange');

    expect(leaks(source, root)).toEqual(['applyArchived', 'applyCreated', 'applyDiscount', 'applyUpdated']);
  });

  it.each([
    "event = { eventName: 'Other' };",
    "({ event } = { event: { eventName: 'Other' } });",
    "for (event of [{ eventName: 'Other' }]) {}",
  ])('rejects a reassigned dispatcher parameter: %s', (write) => {
    const root = base.replace('    const handlerMethod', `    ${write}\n    const handlerMethod`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects a reassigned replay collection parameter', () => {
    const root = base.replace('    for (const event of events)', "    events = [{ eventName: 'Other' }];\n    for (const event of events)");

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects a reassigned replay element binding', () => {
    const root = base.replace('{ this.applyEvent(event); }', "{ event = { eventName: 'Other' }; this.applyEvent(event); }");

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each([
    "events.fill({ eventName: 'Other' });",
    "events[0] = { eventName: 'Other' };",
    "const alias = events; alias.fill({ eventName: 'Other' });",
  ])('rejects mutation of replay collection contents: %s', (write) => {
    const root = base.replace('    for (const event of events)', `    ${write}\n    for (const event of events)`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each(['applyEvent', 'loadFromHistory'])('rejects an unknown computed replacement of %s', (name) => {
    const root = base.replace('  protected applyChange', `  constructor(key: string) { (this as any)[key] = () => {}; }\n  protected applyChange`);
    const extra = `new Account('${name}');`;

    expect(leaks(account, root, extra)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects an unknown computed replacement of a discriminator', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "class Reassigned { eventName = 'Archived'; constructor(key: string) { this[key] = 'Other'; } }";

    expect(leaks(source, base, extra)).toEqual(['applyArchived']);
  });

  it('preserves replay evidence beside known unrelated bulk writes', () => {
    const root = base.replace('  protected applyChange', "  constructor() { Object.assign(this, { label: 'label' }); }\n  protected applyChange");

    expect(leaks(account, root)).toEqual([]);
  });

  it.each([
    "Object['assign'](AggregateRoot.prototype, { ['applyEvent']: () => {} });",
    "Object.assign(unknownTarget, replacements);",
    "Object.assign(unknownTarget, { ...replacements });",
  ])('rejects indirect or uncertain bulk replacements: %s', (write) => {
    expect(leaks(account, base, write)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('preserves replay evidence with a history length check', () => {
    const root = base.replace('    for (const event of events)', '    if (events.length === 0) return;\n    for (const event of events)');

    expect(leaks(account, root)).toEqual([]);
  });

  it.each(['applyEvent', 'loadFromHistory'])('rejects bulk replacement through an initializer alias of %s', (name) => {
    const root = base.replace('  protected applyChange', `  constructor() { const replace = Object.assign; replace(this, { ${name}: () => {} }); }\n  protected applyChange`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each([
    "const { 'assign': replace } = Object; replace(this, { applyEvent: () => {} });",
    "const first = Object.assign; const replace = first; replace(this, { applyEvent: () => {} });",
    "const writers = { replace: Object.assign }; writers.replace(this, { applyEvent: () => {} });",
  ])('rejects bulk replacement through a referenced alias: %s', (write) => {
    const root = base.replace('  protected applyChange', `  constructor() { ${write} }\n  protected applyChange`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects an aliased bulk replacement of an event discriminator', () => {
    const extra = "const replace = Object.assign; replace(new Archived(), { eventName: 'Other' });";

    expect(leaks(account, base, extra)).toEqual(['applyArchived']);
  });

  it('rejects an aliased bulk replacement in mapped source', () => {
    const root = base.replace('  protected applyChange', '  constructor() { const replace = Object.assign; replace(this, { applyEvent: () => {} }); }\n  protected applyChange');
    const model = extract(account, root, '', undefined, true);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('rejects bulk replacements through a spread argument list', () => {
    const root = base.replace('  protected applyChange', '  constructor() { Object.assign(...[this, { applyEvent: () => {} }]); }\n  protected applyChange');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('preserves replay evidence beside unrelated aliased bulk writes', () => {
    const root = base.replace('  protected applyChange', "  constructor() { const copy = Object.assign; copy(this, { label: 'label' }); }\n  protected applyChange");

    expect(leaks(account, root)).toEqual([]);
  });

  it.each([
    "Object.assign.call(null, this, { applyEvent: () => {} });",
    "Object.assign.apply(null, [this, { applyEvent: () => {} }]);",
    "const replace = Object.assign.bind(null); replace(this, { applyEvent: () => {} });",
    "const replace = Object.assign.bind(null, this); replace({ applyEvent: () => {} });",
  ])('rejects bulk replacement through a native invocation wrapper: %s', (write) => {
    const root = base.replace('  protected applyChange', `  constructor() { ${write} }\n  protected applyChange`);

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('preserves replay evidence beside dynamic deletes on a separate plain result', () => {
    const extra = `
declare function toPlain(value: Archived): Record<string, unknown>;
function serialize(event: Archived, key: string) {
  const dto = toPlain(event);
  delete dto[key];
}
`;

    expect(leaks(account, base, extra)).toEqual([]);
  });

  it.each([
    ["const event = new Archived(); event[key] = 'Other';", ['applyArchived']],
    ["const erased: Record<string, unknown> = new Archived(); delete erased[key];", ['applyArchived']],
    ["function replace(event: any) { event[key] = 'Other'; }", ['applyArchived', 'applyCreated', 'applyUpdated']],
  ] as const)('rejects uncertain writes on related receivers: %s', (write, expected) => {
    expect(leaks(account, base, `declare const key: string; ${write}`)).toEqual(expected);
  });

  it.each([
    "const label = { text: 'hello' }; export const clone = Object.assign({}, label);",
    "export const clone = Object.assign({}, { applyEvent: 42 });",
    "export const clone = Object.assign({}, { eventName: 'Other' });",
    "export const clone = Object.assign([], { applyEvent: () => {} });",
    "const copy = Object.assign.bind(null, {}); export const clone = copy({ applyEvent: 42 });",
  ])('preserves replay evidence beside a fresh bulk target: %s', (other) => {
    expect(leaks(account, base, '', { '/src/unrelated.ts': other })).toEqual([]);
  });

  it.each([
    "const labels: Record<string, string> = {}; export function set(key: string) { labels[key] = 'x'; }",
    "export function set(key: string) { const labels: Record<string, string> = {}; labels[key] = 'x'; }",
    "const array: string[] = []; export function set(index: number) { array[index] = 'x'; }",
    "export class Labels { [key: string]: unknown; set(key: string, value: string) { this[key] = value; } }",
    "class Labels { applyEvent() {} loadFromHistory() {} eventName = ''; [key: string]: unknown; set(key: string) { this[key] = 'x'; } }",
    "class Labels { applyEvent() {} } export const labels = Object.assign(new Labels(), { applyEvent: () => {} });",
  ])('preserves replay evidence beside an unrelated receiver: %s', (other) => {
    expect(leaks(account, base, '', { '/src/unrelated.ts': other })).toEqual([]);
  });

  it.each([false, true])('rejects a reassigned receiver alias in direct or mapped source: %s', (mapped) => {
    const root = base.replace('  protected applyChange', '  constructor(key: string) { let alias: object = {}; alias = this; (alias as Record<string, unknown>)[key] = () => {}; }\n  protected applyChange');
    const model = extract(account, root, '', undefined, mapped);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each([false, true])('rejects a bulk write through a reassigned receiver alias: %s', (mapped) => {
    const root = base.replace('  protected applyChange', '  constructor() { let alias: object = {}; alias = this; Object.assign(alias, { applyEvent: () => {} }); }\n  protected applyChange');
    const model = extract(account, root, '', undefined, mapped);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('preserves unrelated aliases reassigned only to fresh objects', () => {
    const other = "let labels: Record<string, unknown> = {}; labels = {}; declare const key: string; labels[key] = 'x'; Object.assign(labels, { applyEvent: 42 });";

    expect(leaks(account, base, '', { '/src/unrelated.ts': other })).toEqual([]);
  });

  it.each([
    "declare const sources: object[]; export const clone = Object.assign({}, ...sources);",
    "declare const sources: object[]; const copy = Object.assign.bind(null, {}, ...sources); export const clone = copy({ applyEvent: 42 });",
    "declare const sources: object[]; export const clone = Object.assign.call(null, {}, ...sources);",
  ])('preserves a known fresh target before an unknown spread: %s', (other) => {
    expect(leaks(account, base, '', { '/src/unrelated.ts': other })).toEqual([]);
  });

  it('does not trust a receiver parameter default as permanent freshness', () => {
    const root = base.replace('  protected applyChange', '  constructor(key: string, alias: object = {}) { (alias as Record<string, unknown>)[key] = () => {}; }\n  protected applyChange');

    expect(leaks(account, root)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('does not confuse constructor fields with instance protocol members', () => {
    const extra = "Object.assign(Account, { applyEvent: 42 }); Object.assign(Archived, { eventName: 'Other' });";

    expect(leaks(account, base, extra)).toEqual([]);
  });

  it('does not confuse static this with an instance protocol receiver', () => {
    const root = base.replace('  protected applyChange', '  static setup() { Object.assign(this, { applyEvent: 42 }); }\n  protected applyChange');

    expect(leaks(account, root)).toEqual([]);
  });

  it.each([
    "label.eventName = 'Other';",
    "Object.assign(label, { eventName: 'Other' });",
  ])('keeps a command judged after a compatible class parameter mutation: %s', (write) => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = `class Label { eventName = 'Label'; }
function replace(label: Label) { ${write} }
class Reassigned { eventName = 'Archived'; constructor() { replace(this); } }`;

    expect(leaks(source, base, extra)).toContain('applyArchived');
  });

  it('accepts the structurally compatible parameter reproduction as valid TypeScript', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "class Label { eventName = 'Label'; } function replace(label: Label) { label.eventName = 'Other'; } class Reassigned { eventName = 'Archived'; constructor() { replace(this); } }";
    const project = inMemoryProject({ '/src/account.ts': base + events + source + extra });

    expect(project.getPreEmitDiagnostics()).toEqual([]);
  });

  it.each(['private', 'protected'])('keeps unrelated %s brands nominal for class parameters', (access) => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = `class Label { ${access} brand = 'label'; eventName = 'Label'; }
function replace(label: Label) { label.eventName = 'Other'; }
class Reassigned { ${access} brand = 'event'; eventName = 'Archived'; }`;

    expect(leaks(source, base, extra)).toEqual([]);
  });

  it.each([
    "class Label { eventName = 'Label'; } Object.assign(new Label(), { eventName: 'Other' });",
    "class Label { eventName = 'Label'; change() { this.eventName = 'Other'; } }",
  ])('keeps known concrete receivers isolated despite a compatible public shape: %s', (extra) => {
    const source = account.replace('event: Archived', 'event: Reassigned');

    expect(leaks(source, base, "class Reassigned { eventName = 'Archived'; change() {} }" + extra)).toEqual([]);
  });

  it.each([false, true])('rejects compatible public replay parameter mutations in direct or mapped source: %s', (mapped) => {
    const helper = 'class Label { loadFromHistory(events: Event[]) {} } function replace(label: Label) { Object.assign(label, { loadFromHistory: () => {} }); } ';
    const root = base.replace('class AggregateRoot', helper + 'class AggregateRoot').replace('class AggregateRoot {', 'class AggregateRoot { constructor() { replace(this); }');
    const model = extract(account, root, '', undefined, mapped);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it.each(['{}', 'EmptyLabel', 'object', 'unknown'])('keeps a command judged after a broad %s parameter mutation', (type) => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const target = type === 'unknown' ? 'label as object' : 'label';
    const extra = `interface EmptyLabel {}
function replace(label: ${type}) { Object.assign(${target}, { eventName: 'Other' }); }
class Reassigned { eventName = 'Archived'; constructor() { replace(this); } }`;

    expect(leaks(source, base, extra)).toContain('applyArchived');
  });

  it('accepts the broad object parameter reproduction as valid TypeScript', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "function replace(label: {}) { Object.assign(label, { eventName: 'Other' }); } class Reassigned { eventName = 'Archived'; constructor() { replace(this); } }";
    const project = inMemoryProject({ '/src/account.ts': base + events + source + extra });

    expect(project.getPreEmitDiagnostics()).toEqual([]);
  });

  it.each([false, true])('rejects broad object replay parameter mutations in direct or mapped source: %s', (mapped) => {
    const helper = 'function replace(label: {}) { Object.assign(label, { loadFromHistory: () => {} }); } ';
    const root = base.replace('class AggregateRoot', helper + 'class AggregateRoot').replace('class AggregateRoot {', 'class AggregateRoot { constructor() { replace(this); }');
    const model = extract(account, root, '', undefined, mapped);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort())
      .toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
  });

  it('keeps structurally incompatible interface parameters unrelated', () => {
    const extra = "interface Label { label: string } function replace(label: Label) { Object.assign(label, { eventName: 'Other', applyEvent: () => {} }); }";

    expect(leaks(account, base, extra)).toEqual([]);
  });

  it('does not trust a broad receiver parameter default as permanent freshness', () => {
    const source = account.replace('event: Archived', 'event: Reassigned');
    const extra = "function replace(label: {} = {}) { Object.assign(label, { eventName: 'Other' }); } class Reassigned { eventName = 'Archived'; constructor() { replace(this); } }";

    expect(leaks(source, base, extra)).toContain('applyArchived');
  });

  it('preserves unknown entry-point roles for conditional serializer roots', () => {
    const model = extract(serializedAccount, base, serializedExtra, undefined, false, transformerFiles());

    expect(roles(model)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('does not report strict provisional appliers with only conditional root writes', () => {
    expect(leaks(serializedAccount, base, serializedExtra, transformerFiles())).toEqual([]);
  });

  it('retains conditional-result writes as possible mutations', () => {
    const model = extract(serializedAccount, base, serializedExtra, undefined, false, transformerFiles());
    const archived = model.aggregates[0]!.methods.find((method) => method.name === 'applyArchived')!;

    expect(archived.fields.get('status')!.sets.tokens).toContain('archived');
  });

  it('keeps proven replay and uncertain replay as distinct roles', () => {
    expect(roles(extract())).toEqual(['replay', 'replay', 'replay']);
  });

  it('keeps mayWrite conservative beside a conditional-copy reason', () => {
    const project = inMemoryProject({ '/src/account.ts': base + events + serializedAccount + serializedExtra, ...transformerFiles() });
    const sources = new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile()));
    const mutation = new MemberMutations(sources);
    const property = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('Archived').getPropertyOrThrow('eventName');

    expect([mutation.mayWrite(property), mutation.evidenceOf(property)]).toEqual([true, 'conditional-copy']);
  });

  it('accepts a renamed named import without assuming a fresh root', () => {
    const source = serializedAccount.replace('instanceToPlain }', 'instanceToPlain as copy }');
    const extra = serializedExtra.replace('instanceToPlain(event)', 'copy(event)');

    expect(roles(extract(source, base, extra, undefined, false, transformerFiles()))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each([false, true])('preserves uncertain roles in direct and mapped replay source: %s', (mapped) => {
    expect(roles(extract(serializedAccount, base, (mapped ? 'interface Event { eventName: string }' : '') + serializedExtra, undefined, mapped, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each([
    'event.eventName = "Other";',
    'function raw(value: Event) { value.eventName = "Other"; }',
    'function replace(target: {}) { Object.assign(target, { applyEvent: () => {} }); }',
    'new Account().applyArchived(new Archived());',
    'const extracted = new Account().applyArchived;',
  ])('preserves independent blockers beside conditional roots: %s', (blocker) => {
    const inside = blocker.startsWith('event.') ? serializedExtra.replace('const result', blocker + ' const result') : serializedExtra + blocker;
    const model = extract(serializedAccount, base, inside, undefined, false, transformerFiles());

    expect(model.aggregates[0]!.methods.find((method) => method.name === 'applyArchived')!.entryPoint).toBe('command');
  });

  it.each([
    'function serialize<T extends Event>(event: T) { let result = instanceToPlain(event); result = event; delete result.eventName; }',
    'declare function other(): Record<string, any>; function serialize<T extends Event>(event: T) { let result = instanceToPlain(event); result = other(); delete result.eventName; }',
    'function serialize<T extends Event>(event: T) { const result = instanceToPlain(event); result.child.eventName = "Other"; }',
    'declare function mutate(value: Event): Event; function serialize<T extends Event>(event: T) { const result = instanceToPlain(mutate(event)); delete result.eventName; }',
    'function serialize<T extends Event>(event: T) { const callback = () => { event.eventName = "Other"; }; const result = instanceToPlain(event); callback(); delete result.eventName; }',
    'function serialize<T extends Event>(event: T) { let result = instanceToPlain(event); ({ result } = { result: event }); delete result.eventName; }',
  ])('does not hide binding, nested or input effects: %s', (extra) => {
    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it.each([
    'instanceToPlain(event, undefined)',
    'instanceToPlain(...[event])',
    'copy(event)',
    'library.instanceToPlain(event)',
    'instanceToPlain(new External(event))',
    'instanceToPlain(new Box(mutate(event)))',
  ])('retains existing behavior for an unsupported call form: %s', (call) => {
    const aliases = call === 'copy(event)' ? 'const copy = instanceToPlain; ' : call.startsWith('library.') ? 'const library = { instanceToPlain }; ' : '';
    const extra = aliases + serializedExtra.replace('instanceToPlain(event)', call);

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it.each(['0.4.0', '0.5.0', '0.5.2'])('retains existing behavior for version %s', (version) => {
    expect(roles(extract(serializedAccount, base, serializedExtra, undefined, false, transformerFiles(version))))
      .toEqual(['command', 'command', 'command']);
  });

  it('does not give a local identity function library authority', () => {
    const source = 'function instanceToPlain<T>(value: T): Record<string, any> { return value as Record<string, any>; }' + account;

    expect(roles(extract(source, base, serializedExtra))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    'import { ClassTransformer } from "class-transformer"; ClassTransformer.prototype.instanceToPlain = value => value;',
    'import { ClassTransformer } from "class-transformer"; const alias = ClassTransformer; unknownConsumer(alias);',
    'import * as module from "class-transformer"; Object.assign(module, { instanceToPlain: value => value });',
    'import * as module from "class-transformer"; const alias = module; Reflect.defineProperty(alias, "instanceToPlain", { value: value => value });',
    'import { ClassTransformer } from "class-transformer"; Object.setPrototypeOf(ClassTransformer.prototype, replacement);',
    'const moduleName = "class-transformer"; const module = require(moduleName); unknownConsumer(module);',
    'const load = require; const module = load("class-transformer"); unknownConsumer(module);',
    'declare const moduleName: string; const module = import(moduleName);',
    'import { ClassTransformer as Delegated } from "/node_modules/class-transformer/types/index"; Delegated.prototype.instanceToPlain = value => value;',
    'const module = require("/node_modules/class-transformer/cjs/ClassTransformer"); unknownConsumer(module);',
    'const module = require("../node_modules/class-transformer/cjs/ClassTransformer"); unknownConsumer(module);',
  ])('withholds conditional semantics after delegated exposure: %s', (exposure) => {
    expect(roles(extract(serializedAccount, base, serializedExtra + exposure, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it('withholds semantics after a delegated class is re-exported by an external declaration', () => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'export { ClassTransformer as Delegated } from "class-transformer";',
    };
    const extra = serializedExtra + 'import { Delegated } from "bridge"; Delegated.prototype.instanceToPlain = value => value;';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    'class StatefulArchived extends Archived { private reads = 0; get then() { return ++this.reads === 1 ? undefined : () => {}; } }',
    'Object.defineProperty(Archived.prototype, "then", { get() { return nextThen(); } });',
  ])('never turns a then hazard into proven replay or freshness: %s', (hazard) => {
    expect(roles(extract(serializedAccount, base, serializedExtra + hazard, undefined, false, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('keeps nearby ordinary commands judged beside uncertain appliers', () => {
    const source = serializedAccount.replace('  updateInfo()', '  applyDiscount() { this.title = "discount"; }\n  updateInfo()');

    expect(leaks(source, base, serializedExtra, transformerFiles())).toEqual(['applyDiscount']);
  });

  it('does not seed transitions from uncertain entry points', () => {
    const model = extract(serializedAccount, base, serializedExtra, undefined, false, transformerFiles());

    expect(suggestLifecycles({ ...model, aggregates: model.aggregates.map((aggregate) => ({ ...aggregate, declared: false })) })[0]!.fields[0]!.transitions).toEqual({ kind: 'none' });
  });

  it('retains unchanged aliases and root-local bulk writes as conditional', () => {
    const extra = 'function serialize<T extends Event>(event: T) { const result = instanceToPlain(event); const alias = result; Object.assign(alias, { eventName: "Other" }); }';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('preserves per-event isolation for independent getter effects', () => {
    const extra = serializedExtra + 'class StatefulArchived extends Archived { get then() { this.eventName = "Other"; return undefined; } }';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'command']);
  });

  it('keeps transition checks quiet for uncertain entry points', () => {
    const model = extract(serializedAccount, base, serializedExtra, new Map([['applyArchived', ['active']]]), false, transformerFiles());

    expect(lifecycleAnalyzer.check(model)).toEqual([]);
  });

  it('uses the nested verified package beside an older root installation', () => {
    const nested = Object.fromEntries(Object.entries(transformerFiles()).map(([path, text]) => [path.replace('/node_modules', '/packages/core/node_modules'), text]));
    const files = { ...transformerFiles('0.4.0'), ...nested,
      '/packages/core/serialize.ts': 'import { instanceToPlain } from "class-transformer"; export function serialize(event: object) { const result = instanceToPlain(event); delete result.eventName; }',
    };

    expect(roles(extract(account, base, '', undefined, false, files))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('does not grant a same-shaped export from another package authority', () => {
    const files = Object.fromEntries(Object.entries(transformerFiles()).map(([path, text]) => [path.replace('class-transformer', 'lookalike'), text.replace('class-transformer', 'lookalike')]));
    const source = serializedAccount.replace("from 'class-transformer'", "from 'lookalike'");

    expect(roles(extract(source, base, serializedExtra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it('does not confuse a shadowed import with the resolved export', () => {
    const extra = 'function serialize(event: Event, instanceToPlain: (value: unknown) => Record<string, any>) { const result = instanceToPlain(event); delete result.eventName; }';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it('does not confuse an unrelated package-name string with delegated exposure', () => {
    expect(roles(extract(serializedAccount, base, serializedExtra + 'console.log("class-transformer");', undefined, false, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each(['Delegated', 'bridge.Delegated'])('withholds semantics through typed constructor aliases: %s', (target) => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'export declare const Delegated: typeof import("class-transformer").ClassTransformer;',
    };
    const imported = target === 'Delegated' ? 'import { Delegated } from "bridge";' : 'import * as bridge from "bridge";';
    const extra = serializedExtra + imported + target + '.prototype.instanceToPlain = value => value;';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    ['export { ClassTransformer as default } from "class-transformer";', 'import Delegated from "bridge"; Delegated.prototype.instanceToPlain = value => value;'],
    ['import { ClassTransformer } from "class-transformer"; export declare const internals: { Transformer: typeof ClassTransformer };', 'import { internals } from "bridge"; internals.Transformer.prototype.instanceToPlain = value => value;'],
    ['import { ClassTransformer } from "class-transformer"; export declare const internals: { Transformer: typeof ClassTransformer };', 'import { internals } from "bridge"; unknownConsumer(internals);'],
  ])('withholds delegated authority through a bridge: %s', (declaration, exposure) => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': declaration };

    expect(roles(extract(serializedAccount, base, serializedExtra + exposure, undefined, false, files)))
      .toEqual(['command', 'command', 'command']);
  });

  it.each([
    'import * as loader from "node:module"; const load = loader.createRequire(import.meta.url); unknownConsumer(load("class-transformer"));',
    'import loader from "node:module"; const load = loader.createRequire(import.meta.url); unknownConsumer(load("class-transformer"));',
    'const loader = require("node:module"); const load = loader.createRequire(import.meta.url); unknownConsumer(load("class-transformer"));',
    'const loader = import("node:module");',
    'declare const loader: any; unknownConsumer(loader["require"]("class-transformer"));',
  ])('withholds semantics after ambiguous native module-loader exposure: %s', (exposure) => {
    expect(roles(extract(serializedAccount, base, serializedExtra + exposure, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it.each(['string', 'number', 'boolean', 'null', 'undefined', 'string[]', 'Set<string>', 'Map<string, string>', 'Date', 'Promise<Event>', '() => void'])('does not extend conditional support to a known %s input', (type) => {
    const extra = `function serialize(event: ${type}) { const result = instanceToPlain(event); delete result.eventName; }`;

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['command', 'command', 'command']);
  });

  it.each([
    'delegated().prototype.instanceToPlain = value => value;',
    'unknownConsumer(delegated);',
  ])('withholds semantics for a bridge factory exposing the actual delegate: %s', (exposure) => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'export declare function delegated(): typeof import("class-transformer").ClassTransformer;',
    };
    const extra = serializedExtra + 'import { delegated } from "bridge"; ' + exposure;

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it('does not confuse an unrelated computed record property with a module loader', () => {
    const extra = serializedExtra + 'const labels: Record<string,string> = {}; labels["require"] = "hello";';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles())))
      .toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('does not interpret an unrelated recursive factory result as delegated exposure', () => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'declare class Logger { child: Logger; info(): Logger; } export declare function logger(): Logger;',
    };
    const extra = serializedExtra + 'import { logger } from "bridge"; logger().info();';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('retains narrow authority beside an unrelated imported string array', () => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': 'export declare const metadata: string[];' };
    const extra = 'import { metadata } from "bridge"; ' + serializedExtra.replace('delete result.eventName;', 'for (const key of metadata) { delete result[key]; }');

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('withholds authority for a named nested factory wrapper', () => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'interface Inner { Transformer: typeof import("class-transformer").ClassTransformer } interface Outer { inner: Inner } export declare function delegated(): Outer;',
    };
    const extra = serializedExtra + 'import { delegated } from "bridge"; unknownConsumer(delegated());';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });


  it('keeps incomplete delegate authority distinct from conditional authority', () => {
    const wide = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `${Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(";")} export declare const metadata: { ${wide} };` };
    const extra = 'import { metadata } from "bridge"; unknownConsumer(metadata); ' + serializedExtra;
    const project = inMemoryProject({ '/src/account.ts': base + events + serializedAccount + extra, ...files });
    const sources = new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile()));
    const copies = new ConditionalCopies(sources);
    const call = project.getSourceFileOrThrow('/src/account.ts').getFunctionOrThrow('serialize').getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;

    expect([copies.isConditionalRoot(call), copies.authorityOf(call)]).toEqual([false, 'unresolved-delegate']);
  });

  it('keeps mayWrite true for incomplete delegate authority', () => {
    const wide = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `${Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(";")} export declare const metadata: { ${wide} };` };
    const extra = 'import { metadata } from "bridge"; unknownConsumer(metadata); ' + serializedExtra;
    const project = inMemoryProject({ '/src/account.ts': base + events + serializedAccount + extra, ...files });
    const mutations = new MemberMutations(new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile())));
    const property = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('Archived').getPropertyOrThrow('eventName');

    expect([mutations.mayWrite(property), mutations.evidenceOf(property)]).toEqual([true, 'unresolved-delegate']);
  });

  it.each(['', 'event.eventName = "Other";', 'import { delegated } from "exposure"; unknownConsumer(delegated);', 'unknownConsumer(require("class-transformer"));'])('aggregates incomplete delegate evidence with later causes: %s', (cause) => {
    const wide = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `${Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(";")} export declare const metadata: { ${wide} };`,
      '/node_modules/exposure/index.d.ts': 'export declare function delegated(): typeof import("class-transformer").ClassTransformer;',
    };
    const extra = 'import { metadata } from "bridge"; unknownConsumer(metadata); ' + (cause.startsWith('event.') ? serializedExtra.replace('const result', cause + 'const result') : serializedExtra + cause);

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(Array(3).fill(cause ? 'command' : 'unknown'));
  });

  it('keeps wrong operation identity judged beside incomplete capability evidence', () => {
    const wide = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles('0.4.0'), '/node_modules/bridge/index.d.ts': `${Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(";")} export declare const metadata: { ${wide} };` };
    const extra = 'import { metadata } from "bridge"; unknownConsumer(metadata); ' + serializedExtra;

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });


  it.each([
    ['export declare namespace internals { function delegated(): typeof import("class-transformer").ClassTransformer; }', 'import { internals } from "bridge"; unknownConsumer(internals);'],
    ['export type * from "class-transformer"; export declare function label(): string;', 'import * as bridge from "bridge"; bridge.label();'],
    ['export type { ClassTransformer } from "class-transformer"; export declare function label(): string;', 'import * as bridge from "bridge"; bridge.label();'],
    ['export declare namespace internals { type Delegated = typeof import("class-transformer").ClassTransformer; function label(): string; }', 'import { internals } from "bridge"; internals.label();'],
    ['declare function factory<T>(): T; export declare const delegated: typeof factory<typeof import("class-transformer").ClassTransformer>;', 'import { delegated } from "bridge"; unknownConsumer(delegated);'],
    ['interface Cycle { child: Cycle; Transformer: typeof import("class-transformer").ClassTransformer } export declare function delegated(): Cycle;', 'import { delegated } from "bridge"; unknownConsumer(delegated);'],
    ['export declare const delegated: Promise<typeof import("class-transformer").ClassTransformer>;', 'import { delegated } from "bridge"; unknownConsumer(delegated);'],
  ])('follows runtime namespace and generic capability surfaces: %s', (declaration, exposure) => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': declaration };
    const expected = declaration.includes('function label()') ? 'unknown' : 'command';

    expect(roles(extract(serializedAccount, base, serializedExtra + exposure, undefined, false, files))).toEqual(Array(3).fill(expected));
  });

  it('withholds conditional authority for an unresolved written surface', () => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': 'export declare const metadata: MissingType;' };
    const extra = 'import { metadata } from "bridge"; unknownConsumer(metadata); ' + serializedExtra;
    const project = inMemoryProject({ '/src/account.ts': base + events + serializedAccount + extra, ...files });
    const sources = new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile()));
    const copies = new ConditionalCopies(sources);
    const call = project.getSourceFileOrThrow('/src/account.ts').getFunctionOrThrow('serialize').getDescendantsOfKind(SyntaxKind.CallExpression)[0]!;

    expect([copies.isConditionalRoot(call), copies.authorityOf(call)]).toEqual([false, 'unresolved-delegate']);
  });


  it('keeps a positively resolved older constructor separate from the nested verified root', () => {
    const nested = Object.fromEntries(Object.entries(transformerFiles()).map(([path, text]) => [path.replace('/node_modules', '/packages/core/node_modules'), text]));
    const files = { ...transformerFiles('0.4.0'), ...nested,
      '/packages/core/serialize.ts': 'import { instanceToPlain } from "class-transformer"; export function serialize(event: object) { const result = instanceToPlain(event); delete result.eventName; }',
    };
    const extra = 'import { ClassTransformer } from "class-transformer"; unknownConsumer(ClassTransformer);';

    expect(roles(extract(account, base, extra, undefined, false, files))).toEqual(['unknown', 'unknown', 'unknown']);
  });


  it('follows chained runtime stars without reviving erased constructor exports', () => {
    const files = { ...transformerFiles(),
      '/node_modules/bridge/index.d.ts': 'export * from "./types"; export declare function label(): string;',
      '/node_modules/bridge/types.d.ts': 'export type * from "class-transformer";',
    };
    const extra = serializedExtra + 'import * as bridge from "bridge"; bridge.label();';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['unknown', 'unknown', 'unknown']);
  });


  it.each([
    'const load = module["require"]; const delegated = load("class-transformer");',
    'const delegated = module["require"].bind(module)("class-transformer");',
    'const delegated = module["require"].call(module, "class-transformer");',
    'const delegated = module["require"].apply(module, ["class-transformer"]);',
  ])('blocks review computed loader extraction and native invocation: %s', (load) => {
    const extra = serializedExtra + 'declare const module: { [key: string]: (name: string) => any };' + load + 'delegated.ClassTransformer.prototype.instanceToPlain = (value: unknown) => value;';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, transformerFiles()))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    'const table = { require: "label" }; const load = table["require"];',
    'const table = { require: (name: string) => name }; const load = table["require"]; load("class-transformer");',
    'function require(name: string) { return name; } require("class-transformer");',
    'const table = { require: (name: string) => ({ label: name }) }; const load = table["require"]; load("class-transformer");',
  ])('keeps review unrelated require properties and shadowing quiet: %s', (extra) => {
    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, transformerFiles()))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each([
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): T;', 'command'],
    ['export declare function delegated<T extends object = typeof import("class-transformer").ClassTransformer>(): T;', 'command'],
    ['export declare function delegated<T = string>(): T;', 'unknown'],
  ])('follows review outward generic defaults: %s', (declaration, expected) => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': declaration };
    const extra = serializedExtra + 'import { delegated } from "bridge"; declare function consume(factory: () => any): void; consume(delegated);';

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(Array(3).fill(expected));
  });

  it.each([
    ['Object.defineProperty(AggregateRoot.prototype, "applyEvent", { value: (event: Event) => {} });', 'command'],
    ['Reflect.defineProperty(AggregateRoot.prototype, "loadFromHistory", { value: (events: Event[]) => {} });', 'command'],
    ['Object.defineProperty(AggregateRoot.prototype, "label", { value: () => {} });', 'replay'],
    ['class Other { applyEvent() {} } Object.defineProperty(Other.prototype, "applyEvent", { value: () => {} });', 'replay'],
    ['Object.defineProperty(AggregateRoot.prototype, "applyEvent", { enumerable: true });', 'replay'],
    ['Object.defineProperty(Archived.prototype, "eventName", { value: "Other" });', 'replay'],
  ])('correlates review reflective replacement with protocol behavior: %s', (extra, expected) => {
    expect(roles(extract(account, base, extra))).toEqual(Array(3).fill(expected));
  });

  it.each([
    'declare const module: { [key: string]: (name: string) => any }; const load = module["require"]; const delegated = load("class-transformer"); delegated.ClassTransformer.prototype.instanceToPlain = (value: unknown) => value;',
    'declare const module: { [key: string]: (name: string) => any }; const delegated = module["require"].bind(module)("class-transformer"); delegated.ClassTransformer.prototype.instanceToPlain = (value: unknown) => value;',
    'Object.defineProperty(AggregateRoot.prototype, "applyEvent", { value: (event: Event) => {} });',
    'function raw(event: Event) { event.eventName = "Other"; }',
  ])('keeps review later blockers dominant over incomplete capability evidence: %s', (cause) => {
    const wide = Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(';');
    const shape = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `${wide} export declare const metadata: { ${shape} };` };
    const extra = 'import { metadata } from "bridge"; declare function consume(value: unknown): void; consume(metadata);' + serializedExtra + cause;

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });


  it.each([
    ['interface Box<T = typeof import("class-transformer").ClassTransformer> { value: T } export declare const delegated: Box<string>;', 'declare function consume(value: unknown): void; consume(delegated);', 'unknown'],
    ['interface Box<T = string> { value: T } export declare const delegated: Box<typeof import("class-transformer").ClassTransformer>;', 'declare function consume(value: unknown): void; consume(delegated);', 'command'],
    ['export declare function delegated<T = string>(): T;', 'delegated<string>();', 'unknown'],
    ['export declare function delegated<T = string>(): T;', 'declare function consume(value: unknown): void; consume(delegated<typeof import("class-transformer").ClassTransformer>);', 'command'],
    ['interface Box<T = typeof import("class-transformer").ClassTransformer> { label: string } export declare const delegated: Box;', 'declare function consume(value: unknown): void; consume(delegated);', 'unknown'],
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(input?: T): string;', 'declare function consume(value: unknown): void; consume(delegated);', 'unknown'],
    ['export declare function delegated(input: typeof import("class-transformer").ClassTransformer): string;', 'declare function consume(value: unknown): void; consume(delegated);', 'unknown'],
  ])('preserves review actual generic arguments and input-only types: %s', (declaration, use, expected) => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': declaration };

    expect(roles(extract(serializedAccount, base, serializedExtra + 'import { delegated } from "bridge";' + use, undefined, false, files))).toEqual(Array(3).fill(expected));
  });

  it('retains review own arrow protocol behavior after a prototype replacement', () => {
    const root = base.replace('private applyEvent(event: Event, isNew = false) {', 'private applyEvent = (event: Event, isNew = false) => {');
    const extra = 'Object.defineProperty(AggregateRoot.prototype, "applyEvent", { value: (event: Event) => {} });';

    const project = inMemoryProject({ '/src/account.ts': root + events + account + extra });
    const mutations = new MemberMutations(new SourceIndex(project.getSourceFiles().filter((file) => !file.isDeclarationFile())));
    const member = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('AggregateRoot').getPropertyOrThrow('applyEvent');

    expect(mutations.evidenceOf(member)).toBe('none');
  });

  it('retains review own discriminator behavior through a prototype alias', () => {
    const extra = 'const target = Archived.prototype; Object.defineProperty(target, "eventName", { value: "Other" });';

    expect(roles(extract(account, base, extra))).toEqual(['replay', 'replay', 'replay']);
  });

  it('keeps review instance discriminator replacement judged', () => {
    const extra = 'Object.defineProperty(new Archived(), "eventName", { value: "Other" });';

    expect(roles(extract(account, base, extra))).toEqual(['replay', 'replay', 'command']);
  });

  it('keeps review reassigned prototype aliases judged', () => {
    const extra = 'let target = Archived.prototype; target = new Archived(); Object.defineProperty(target, "eventName", { value: "Other" });';

    expect(roles(extract(account, base, extra))).toEqual(['replay', 'replay', 'command']);
  });

  it('does not confuse review shadowed reflection with the built-in operation', () => {
    const extra = 'function inspect(Object: { defineProperty(target: object, key: string, value: object): void }) { Object.defineProperty(AggregateRoot.prototype, "applyEvent", { value: () => {} }); }';

    expect(roles(extract(account, base, extra))).toEqual(['replay', 'replay', 'replay']);
  });


  it.each(['["require"]', '[`require`]', '"require"'])('blocks round2 normalized loader bindings: %s', (key) => {
    const extra = `declare const module: { [key: string]: (name: string) => any }; const { ${key}: load } = module; const delegated = load("class-transformer"); delegated.ClassTransformer.prototype.instanceToPlain = (value: unknown) => value;`;

    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, transformerFiles()))).toEqual(['command', 'command', 'command']);
  });

  it.each(['Object', 'Reflect'])('keeps round2 reflected strings separate from %s private brands', (builtin) => {
    const root = base.replace('private applyEvent', '#applyEvent').replaceAll('this.applyEvent(', 'this.#applyEvent(');

    expect(roles(extract(account, root, `${builtin}.defineProperty(AggregateRoot.prototype, "#applyEvent", { value: () => {} });`))).toEqual(['replay', 'replay', 'replay']);
  });

  it.each([
    '{ "value": () => {} }',
    '{ ["value"]: () => {} }',
    'descriptor',
    '{ ...descriptor }',
  ])('retains round2 opaque or normalized behavioral descriptors: %s', (descriptor) => {
    const extra = `declare const descriptor: PropertyDescriptor; Object.defineProperty(AggregateRoot.prototype, "applyEvent", ${descriptor});`;

    expect(roles(extract(account, base, extra))).toEqual(['command', 'command', 'command']);
  });

  it.each([false, true])('aggregates round2 independent generic contexts in one named wrapper: %s', (reverse) => {
    const members = ['safe: typeof delegated<string>', 'generic: typeof delegated'];
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): T; interface Wrapper { ${(reverse ? [...members].reverse() : members).join(';')} } export declare const wrapper: Wrapper;` };
    const extra = 'import { wrapper } from "bridge"; declare function consume(value: unknown): void; consume(wrapper);';

    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): T;', 'delegated<string>();', 'unknown'],
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): number;', 'delegated<typeof import("class-transformer").ClassTransformer>();', 'unknown'],
    ['interface Box<T = typeof import("class-transformer").ClassTransformer> { value: string } export declare const delegated: Box<typeof import("class-transformer").ClassTransformer>;', 'declare function consume(value: unknown): void; consume(delegated);', 'unknown'],
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): T;', 'const safe = delegated<string>; declare function consume(value: unknown): void; consume(delegated);', 'command'],
    ['export declare function delegated<T = typeof import("class-transformer").ClassTransformer>(): T;', 'declare function consume(value: unknown): void; consume(delegated); const safe = delegated<string>;', 'command'],
  ])('follows round2 bound arguments only through outward uses: %s', (declaration, use, expected) => {
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': declaration };

    expect(roles(extract(serializedAccount, base, serializedExtra + 'import { delegated } from "bridge";' + use, undefined, false, files))).toEqual(Array(3).fill(expected));
  });


  it.each([
    'const module = { require: "label" }; const { ["require"]: load } = module;',
    'const module = { require: (name: string) => name }; const { ["require"]: load } = module; load("class-transformer");',
    'const descriptor = { ["enumerable"]: true }; Object.defineProperty(AggregateRoot.prototype, "applyEvent", descriptor);',
  ])('keeps round2 normalized unrelated bindings and attribute descriptors quiet: %s', (extra) => {
    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, transformerFiles()))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each([
    ['Object', 'enumerable'],
    ['Reflect', 'enumerable'],
    ['Object', 'configurable'],
    ['Reflect', 'configurable'],
  ])('retains direct descriptor getter effects for %s %s', (builtin, attribute) => {
    const extra = `${builtin}.defineProperty(AggregateRoot.prototype, "applyEvent", { get ${attribute}() { (this as PropertyDescriptor).value = (event: Event) => {}; return true; } });`;

    expect(roles(extract(account, base, extra))).toEqual(['command', 'command', 'command']);
  });

  it.each(['Object', 'Reflect'])('keeps direct boolean attribute data quiet for %s', (builtin) => {
    const extra = `${builtin}.defineProperty(AggregateRoot.prototype, "applyEvent", { ["enumerable"]: true, 'configurable': false, writable: true });`;

    expect(roles(extract(account, base, extra))).toEqual(['replay', 'replay', 'replay']);
  });

  it.each(['Object', 'Reflect'])('keeps an isolated attribute descriptor alias quiet for %s', (builtin) => {
    const extra = `const descriptor = { ["enumerable"]: true, 'configurable': false, writable: true }; ${builtin}.defineProperty(AggregateRoot.prototype, "applyEvent", descriptor);`;

    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, transformerFiles()))).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it.each([
    'let descriptor: PropertyDescriptor = { enumerable: true }; descriptor = { value: () => {} };',
    'const descriptor: PropertyDescriptor = { enumerable: true }; Object.assign(descriptor, { value: () => {} });',
    'const descriptor: PropertyDescriptor = { enumerable: true }; descriptor.value = () => {};',
    'const descriptor: PropertyDescriptor = { enumerable: true }; descriptor["value"] = () => {};',
    'const descriptor = { enumerable: true }; declare function consume(value: object): void; consume(descriptor);',
    'const descriptor: PropertyDescriptor = { enumerable: true }; const alias = descriptor; alias.value = () => {};',
    'export const descriptor = { enumerable: true };',
    'const descriptor = { get enumerable() { return true; } };',
    'declare const key: string; const descriptor = { [key]: true };',
    'declare const other: PropertyDescriptor; const descriptor = { enumerable: true, ...other };',
    'const descriptor = { ["value"]: () => {} };',
  ])('retains mutation evidence for an unproved attribute descriptor alias: %s', (setup) => {
    const extra = setup + 'Object.defineProperty(AggregateRoot.prototype, "applyEvent", descriptor);';

    expect(roles(extract(serializedAccount, base, serializedExtra + extra, undefined, false, transformerFiles()))).toEqual(['command', 'command', 'command']);
  });

  it.each([
    'declare const module: { [key: string]: (name: string) => any }; const { ["require"]: load } = module; load("class-transformer");',
    'declare const descriptor: PropertyDescriptor; Reflect.defineProperty(AggregateRoot.prototype, "loadFromHistory", { ...descriptor });',
  ])('keeps round2 positive causes dominant after incomplete queries: %s', (cause) => {
    const wide = Array.from({ length: 70 }, (_, i) => `interface Wide${i} { label: string }`).join(';');
    const fields = Array.from({ length: 70 }, (_, i) => `p${i}: Wide${i}`).join(';');
    const files = { ...transformerFiles(), '/node_modules/bridge/index.d.ts': `${wide} export declare const metadata: { ${fields} };` };
    const extra = 'import { metadata } from "bridge"; declare function consume(value: unknown): void; consume(metadata);' + serializedExtra + cause;

    expect(roles(extract(serializedAccount, base, extra, undefined, false, files))).toEqual(['command', 'command', 'command']);
  });

  it('recognises literal event discriminators', () => {
    expect(leaks(account.replace('event: Updated', 'event: LiteralUpdated'), base, "class LiteralUpdated { eventName = 'Updated'; }")).toEqual([]);
  });
});
