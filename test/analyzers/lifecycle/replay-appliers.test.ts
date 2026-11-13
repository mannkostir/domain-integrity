import { describe, expect, it } from 'vitest';
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

  it('recognises literal event discriminators', () => {
    expect(leaks(account.replace('event: Updated', 'event: LiteralUpdated'), base, "class LiteralUpdated { eventName = 'Updated'; }")).toEqual([]);
  });
});
