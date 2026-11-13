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

const extract = (source = account, root = base, extra = '', transitions?: ReadonlyMap<string, readonly string[]>, mappedBase = false) => {
  const project = inMemoryProject(mappedBase ? {
    '/src/account.ts': "import { AggregateRoot } from '../dist/base';\n" + events + source + extra,
    '/src/base.ts': root.replace('class AggregateRoot', 'export class AggregateRoot'),
    '/dist/base.d.ts': 'export declare class AggregateRoot { protected applyChange(event: unknown): void; private applyEvent; loadFromHistory(events: unknown[]): void; }\n//# sourceMappingURL=base.d.ts.map',
  } : { '/src/account.ts': root + events + source + extra });
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

const leaks = (source = account, root = base, extra = '') =>
  lifecycleAnalyzer.check(extract(source, root, extra)).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method).sort();

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

    expect(leaks(source, base, extra)).toEqual(['applyArchived', 'applyCreated', 'applyUpdated']);
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

  it('recognises literal event discriminators', () => {
    expect(leaks(account.replace('event: Updated', 'event: LiteralUpdated'), base, "class LiteralUpdated { eventName = 'Updated'; }")).toEqual([]);
  });
});
