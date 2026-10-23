import { CompilerOptions } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/engine/errors';
import { readDeclaration } from '../../src/engine/read-config';
import { OptionPath, RENAMED_OPTIONS, optionPath } from '../../src/engine/renamed-options';
import { AGGREGATE_ROOT, inMemoryProject } from '../helpers/in-memory';

const DOMAIN = {
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', cancelled = 'CANCELLED' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  cancel(): void { this.props.status = OrderStatus.cancelled; }
}
`,
  '/src/payments.ts': `
export class PaymentCaptured { private constructor() {} }
export class PaymentFailed {}
export class OrderSaga {}
`,
};

const read = (config: string, compilerOptionOverrides: CompilerOptions = {}) => {
  const project = inMemoryProject({ ...DOMAIN, '/domain.config.ts': config }, compilerOptionOverrides);
  return readDeclaration(project.getSourceFileOrThrow('/domain.config.ts'));
};

describe('readDeclaration', () => {
  it('applies defaults when optional lists are omitted', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`);

    expect(declaration).toEqual({
      aggregateBaseClasses: ['AggregateRoot', 'Entity'],
      auditFields: ['createdAt', 'updatedAt', 'version'],
      eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
      inertDecorators: [],
      inertEventMethods: [],
      inertMembers: [],
      lifecycles: [],
      reportTestFileMutations: false,
      events: { handlerDecorators: ['EventsHandler', 'OnEvent'], registerMethods: ['register'], inProcess: [], sagas: [] },
      rules: new Map(),
      suppressions: [],
    });
  });

  it('resolves the class, enum values, transitions and exemptions of a lifecycle', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { cancel: { from: [OrderStatus.pending] } } } }, allowAfterTerminal: ['cancel'] })],
});
`).declaration.lifecycles;

    expect({
      target: order?.target.getName(),
      fields: order?.fields,
      allowAfterTerminal: order?.allowAfterTerminal,
    }).toEqual({
      target: 'Order',
      fields: [{ name: 'status', terminal: ['CANCELLED'], transitions: new Map([['cancel', ['PENDING']]]), allowAfterTerminal: [] }],
      allowAfterTerminal: ['cancel'],
    });
  });

  it('reads single terminal values for nullable and boolean fields', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { closedAt: { terminal: 'set' }, archived: { terminal: true } } })],
});
`).declaration.lifecycles;

    expect(order?.fields.map((field) => field.terminal)).toEqual([['set'], ['true']]);
  });

  it('reports type errors in the config as a ConfigError', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { reopen: [] } } } })],
});
`),
    ).toThrow(/Type errors in domain.config.ts/);
  });

  it('requires a default export of defineDomain', () => {
    expect(() => read('export default {};')).toThrow(ConfigError);
  });

  it('rejects syntax it cannot read statically, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const lifecycles = [] as const;
export default defineDomain({ lifecycles });
`),
    ).toThrow(/domain.config.ts:4/);
  });

  it('ignores project-level diagnostics that do not belong to the config file', () => {
    const { declaration } = read(
      `
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`,
      { baseUrl: '/' },
    );

    expect(declaration.lifecycles).toEqual([]);
  });

  it('rejects a state field spec without terminal', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: {
    // @ts-expect-error
    status: {},
  } })],
});
`),
    ).toThrow(/needs "terminal"/);
  });

  it('rejects a state value that is not a literal', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
const value = 'x' as string;
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [value] } } })],
});
`),
    ).toThrow(/cannot resolve/);
  });

  it('defaults allowAfterTerminal to an empty list', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled] } } })],
});
`).declaration.lifecycles;

    expect(order?.allowAfterTerminal).toEqual([]);
  });

  it('reads allowAfterTerminal inside a state field', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], allowAfterTerminal: ['cancel'] } } })],
});
`).declaration.lifecycles;

    expect(order?.fields.map((field) => field.allowAfterTerminal)).toEqual([['cancel']]);
  });

  it('defaults a state field allowAfterTerminal to an empty list', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled] } } })],
});
`).declaration.lifecycles;

    expect(order?.fields.map((field) => field.allowAfterTerminal)).toEqual([[]]);
  });

  it('rejects a state field allowAfterTerminal entry that is not a method', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], allowAfterTerminal: ['nope'] } } })],
});
`),
    ).toThrow(ConfigError);
  });

  it('rejects a non-string entry in aggregateBaseClasses', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'Base' as string;
export default defineDomain({ aggregateBaseClasses: [name] });
`),
    ).toThrow(ConfigError);
  });

  it('reads inertDecorators', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ inertDecorators: ['Audited'] });
`);

    expect(declaration.inertDecorators).toEqual(['Audited']);
  });

  it('rejects a non-string entry in inertDecorators', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'Audited' as string;
export default defineDomain({ inertDecorators: [name] });
`),
    ).toThrow(/expected a string literal/);
  });

  it('rejects inertDecorators that is not an array literal, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const names = ['Audited'];
export default defineDomain({ inertDecorators: names });
`),
    ).toThrow(/domain.config.ts:4 expected an array literal/);
  });

  it('reads inertMembers', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ inertMembers: ['id', 'clearDomainEvents'] });
`);

    expect(declaration.inertMembers).toEqual(['id', 'clearDomainEvents']);
  });

  it('rejects a non-string entry in inertMembers', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'id' as string;
export default defineDomain({ inertMembers: [name] });
`),
    ).toThrow(/expected a string literal/);
  });

  it('rejects inertMembers that is not an array literal, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const names = ['id'];
export default defineDomain({ inertMembers: names });
`),
    ).toThrow(/domain.config.ts:4 expected an array literal/);
  });

  it('does not report test-file mutations by default', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`);

    expect(declaration.reportTestFileMutations).toBe(false);
  });

  it('reads reportTestFileMutations', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ reportTestFileMutations: true });
`);

    expect(declaration.reportTestFileMutations).toBe(true);
  });

  it('rejects a reportTestFileMutations that is not a boolean literal, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const report = true as boolean;
export default defineDomain({ reportTestFileMutations: report });
`),
    ).toThrow(/domain.config.ts:4 "reportTestFileMutations" must be true or false/);
  });

  it('rejects a computed reportTestFileMutations with a ConfigError', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ reportTestFileMutations: Boolean(1) });
`),
    ).toThrow(ConfigError);
  });

  it('reads inertEventMethods listed in eventMethods', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ eventMethods: ['record'], inertEventMethods: ['record'] });
`);

    expect(declaration.inertEventMethods).toEqual(['record']);
  });

  it('accepts inertEventMethods from the default eventMethods', () => {
    const { declaration } = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ inertEventMethods: ['addDomainEvent'] });
`);

    expect(declaration.inertEventMethods).toEqual(['addDomainEvent']);
  });

  it('rejects an inertEventMethods entry outside eventMethods', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ eventMethods: ['apply'], inertEventMethods: ['addDomainEvent'] });
`),
    ).toThrow('"inert.raiseMethods" lists "addDomainEvent", which is not in "events.raiseMethods".');
  });

  it('rejects a misspelled inertEventMethods entry with a ConfigError', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ inertEventMethods: ['addDomainEvents'] });
`),
    ).toThrow(ConfigError);
  });

  it('rejects a non-string entry in inertEventMethods', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'addDomainEvent' as string;
export default defineDomain({ inertEventMethods: [name] });
`),
    ).toThrow(/expected a string literal/);
  });
});

describe('readDeclaration events', () => {
  const header = `
import { defineDomain, saga } from 'domain-integrity';
import { OrderSaga, PaymentCaptured, PaymentFailed } from './src/payments';
`;

  it('resolves in-process classes, saga targets and outcomes', () => {
    const { declaration: { events } } = read(`${header}
export default defineDomain({ events: { handlerDecorators: ['HandleEvent'], registerMethods: [], inProcess: [PaymentFailed], sagas: [saga(OrderSaga, { outcomes: [[PaymentCaptured, PaymentFailed]] })] } });
`);

    expect({
      handlerDecorators: events.handlerDecorators,
      registerMethods: events.registerMethods,
      inProcess: events.inProcess.map((cls) => cls.getName()),
      sagas: events.sagas.map((declared) => [declared.target.getName(), declared.outcomes.map((pair) => pair.map((cls) => cls.getName()))]),
    }).toEqual({
      handlerDecorators: ['HandleEvent'],
      registerMethods: [],
      inProcess: ['PaymentFailed'],
      sagas: [['OrderSaga', [['PaymentCaptured', 'PaymentFailed']]]],
    });
  });

  it('rejects an outcome whose success and failure are the same class', () => {
    expect(() => read(`${header}
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: [[PaymentFailed, PaymentFailed]] })] } });
`)).toThrow(/both success and failure/);
  });

  it('rejects an in-process entry that is not a class reference', () => {
    expect(() => read(`${header}
const Alias = PaymentFailed;
export default defineDomain({ events: { inProcess: [Alias] } });
`)).toThrow(/each entry of "events.inProcess" must be a class reference/);
  });

  it('rejects an outcome that is not an array literal', () => {
    expect(() => read(`${header}
const pair = [PaymentCaptured, PaymentFailed] as const;
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: [pair] })] } });
`)).toThrow(/each outcome must be a \[success, failure\] array literal/);
  });

  it('rejects a saga entry that is not a saga() call', () => {
    expect(() => read(`${header}
const declared = saga(OrderSaga, { outcomes: [] });
export default defineDomain({ events: { sagas: [declared] } });
`)).toThrow(/saga\(\.\.\.\) call/);
  });

  it('rejects a class declared only in a .d.ts file', () => {
    const project = inMemoryProject({
      ...DOMAIN,
      '/types/external.d.ts': 'export declare class ExternalEvent {}',
      '/domain.config.ts': `
import { defineDomain } from 'domain-integrity';
import { ExternalEvent } from './types/external';
export default defineDomain({ events: { inProcess: [ExternalEvent] } });
`,
    });

    expect(() => readDeclaration(project.getSourceFileOrThrow('/domain.config.ts'))).toThrow(/declared in the project/);
  });

  it('rejects events that is not an object literal', () => {
    expect(() => read(`${header}
const declared = {};
export default defineDomain({ events: declared });
`)).toThrow(/"events" must be an object literal/);
  });

  it('rejects a saga spec that is not an object literal', () => {
    expect(() => read(`${header}
const spec = { outcomes: [] };
export default defineDomain({ events: { sagas: [saga(OrderSaga, spec)] } });
`)).toThrow(/argument 2 of saga\(\) must be an object literal/);
  });

  it('rejects outcomes that is not an array literal', () => {
    expect(() => read(`${header}
const list: [] = [];
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: list })] } });
`)).toThrow(/expected an array literal/);
  });

  it('rejects an outcome with one element', () => {
    expect(() => read(`${header}
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: [[PaymentCaptured]] })] } });
`)).toThrow(/Type errors in domain.config.ts/);
  });

  it('rejects an outcome with three elements', () => {
    expect(() => read(`${header}
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: [[PaymentCaptured, PaymentFailed, PaymentFailed]] })] } });
`)).toThrow(/Type errors in domain.config.ts/);
  });

  it('rejects a handler decorator that is not a string literal', () => {
    expect(() => read(`${header}
const decorator = 'HandleEvent';
export default defineDomain({ events: { handlerDecorators: [decorator] } });
`)).toThrow(/expected a string literal/);
  });

  it('rejects a saga target that is not a project class', () => {
    expect(() => read(`${header}
const Alias = OrderSaga;
export default defineDomain({ events: { sagas: [saga(Alias, { outcomes: [] })] } });
`)).toThrow(/the first argument of saga\(\) must be a class reference/);
  });

  it('rejects an outcome element that is not a project class', () => {
    expect(() => read(`${header}
const Alias = PaymentFailed;
export default defineDomain({ events: { sagas: [saga(OrderSaga, { outcomes: [[PaymentCaptured, Alias]] })] } });
`)).toThrow(/an outcome element must be a class reference/);
  });
});

const nested = (path: readonly string[], value: string): string =>
  path.reduceRight((inner, segment, index) => (index === path.length - 1 ? `${segment}: ${value}` : `${segment}: { ${inner} }`), '');

const configSetting = (setting: string): string =>
  `import { defineDomain } from 'domain-integrity';\nexport default defineDomain({\n  ${setting},\n});\n`;

const RENAMED = Object.entries(RENAMED_OPTIONS).filter(([field]) => field !== 'reportTestFileMutations');

describe('renamed options', () => {
  it.each(RENAMED)('reads %s from its grouped name without a deprecation', (field, option) => {
    const reading = read(configSetting(nested(option.current, "['addEvent']")));

    expect({ value: reading.declaration[field as keyof typeof RENAMED_OPTIONS], deprecations: reading.deprecations }).toEqual({
      value: ['addEvent'],
      deprecations: [],
    });
  });

  it.each(RENAMED)('reads %s from its old name with a deprecation', (field, option) => {
    const reading = read(configSetting(nested(option.old, "['addEvent']")));

    expect({ value: reading.declaration[field as keyof typeof RENAMED_OPTIONS], deprecations: reading.deprecations }).toEqual({
      value: ['addEvent'],
      deprecations: [{ line: 3, old: optionPath(option.old), replacement: optionPath(option.current) }],
    });
  });

  it.each(RENAMED)('rejects %s set under both its old and grouped names at the lines of their keys', (_field, option) => {
    const setting = (path: OptionPath): string => nested(path, "['addEvent']").replace(": ['addEvent']", ":\n    ['addEvent']");

    expect(() => read(configSetting(`${setting(option.old)},\n  ${setting(option.current)}`))).toThrow(
      `domain.config.ts:3 sets "${optionPath(option.old)}" and domain.config.ts:5 sets "${optionPath(option.current)}". Keep only "${optionPath(option.current)}".`,
    );
  });

  it.each(RENAMED)('reports the line of the %s key when its value starts on the next line', (_field, option) => {
    const reading = read(configSetting(nested(option.old, "['addEvent']").replace(": ['addEvent']", ":\n    ['addEvent']")));

    expect(reading.deprecations.map((deprecation) => deprecation.line)).toEqual([3]);
  });

  it('reports the line of the method key when a bare transitions array starts on the next line', () => {
    const reading = read(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: {
    cancel:
      [OrderStatus.pending] } } } })],
});
`);

    expect(reading.deprecations.map((deprecation) => deprecation.line)).toEqual([5]);
  });

  it('orders deprecations by line when old names are set against the reading order', () => {
    const reading = read(`import { defineDomain } from 'domain-integrity';
export default defineDomain({
  inertMembers: ['id'],
  aggregateBaseClasses: ['AggregateRoot'],
});
`);

    expect(reading.deprecations.map(({ line, old }) => ({ line, old }))).toEqual([
      { line: 3, old: 'inertMembers' },
      { line: 4, old: 'aggregateBaseClasses' },
    ]);
  });

  it('names the grouped options when inert raise methods are not raise methods', () => {
    expect(() => read(configSetting("inert: { raiseMethods: ['notAnEventMethod'] }"))).toThrow(
      '"inert.raiseMethods" lists "notAnEventMethod", which is not in "events.raiseMethods".',
    );
  });

  it('rejects a group that is not an object literal', () => {
    expect(() =>
      read(`import { defineDomain } from 'domain-integrity';
const shared = { baseClasses: ['AggregateRoot'] };
export default defineDomain({ aggregates: shared });
`),
    ).toThrow(/domain.config.ts:3 "aggregates" must be an object literal/);
  });
});

describe('rules', () => {
  it('reads levels and option objects', () => {
    const { rules } = read(configSetting("rules: { 'transition-missing': 'off', 'unhandled-event': { level: 'warning' }, 'outside-mutation': { testFiles: true } }")).declaration;

    expect(rules).toEqual(new Map([['transition-missing', 'off'], ['unhandled-event', 'warning']]));
  });

  it('reads testFiles as test-file mutation reporting', () => {
    expect(read(configSetting("rules: { 'outside-mutation': { testFiles: true } }")).declaration.reportTestFileMutations).toBe(true);
  });

  it('leaves test files unreported when outside-mutation has only a level', () => {
    expect(read(configSetting("rules: { 'outside-mutation': 'warning' }")).declaration.reportTestFileMutations).toBe(false);
  });

  it('deprecates reportTestFileMutations', () => {
    expect(read(configSetting('reportTestFileMutations: true')).deprecations).toEqual([
      { line: 3, old: 'reportTestFileMutations', replacement: "rules['outside-mutation'].testFiles" },
    ]);
  });

  it('rejects reportTestFileMutations next to testFiles', () => {
    expect(() =>
      read(`import { defineDomain } from 'domain-integrity';
export default defineDomain({
  reportTestFileMutations: true,
  rules: { 'outside-mutation': { testFiles: true } },
});
`),
    ).toThrow(`Keep only "rules['outside-mutation'].testFiles".`);
  });

  it('rejects a testFiles that is not a boolean literal', () => {
    expect(() =>
      read(`import { defineDomain } from 'domain-integrity';
const maybe = true as boolean;
export default defineDomain({ rules: { 'outside-mutation': { testFiles: maybe } } });
`),
    ).toThrow(`"rules['outside-mutation'].testFiles" must be true or false`);
  });

  it('rejects an unknown rule', () => {
    expect(() => read(configSetting("rules: { 'no-such-rule': 'off' }"))).toThrow(ConfigError);
  });
});

const SUPPRESSIONS = (entry: string): string => `import { defineDomain, suppress } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  suppressions: [${entry}],
});
`;

describe('suppressions', () => {
  it('reads the rule, class, member, reason and line', () => {
    const [suppression] = read(SUPPRESSIONS("suppress(Order, { rule: 'terminal-state-leak', member: 'cancel', reason: 'Cancelling twice is harmless.' })")).declaration.suppressions;

    expect({ ...suppression, target: suppression?.target.getName() }).toEqual({
      rule: 'terminal-state-leak',
      target: 'Order',
      member: 'cancel',
      reason: 'Cancelling twice is harmless.',
      line: 4,
    });
  });

  it('reads a suppression without a member', () => {
    const [suppression] = read(SUPPRESSIONS("suppress(Order, { rule: 'unhandled-event', reason: 'R' })")).declaration.suppressions;

    expect(suppression?.member).toBeUndefined();
  });

  it('rejects a blank reason', () => {
    expect(() => read(SUPPRESSIONS("suppress(Order, { rule: 'unhandled-event', reason: '  ' })"))).toThrow(
      'domain.config.ts:4 suppress(Order) needs a non-empty "reason".',
    );
  });

  it('rejects an entry that is not a suppress call', () => {
    expect(() => read(SUPPRESSIONS("{ kind: 'suppression', target: Order, spec: {} }"))).toThrow(
      /each entry of "suppressions" must be a suppress\(\.\.\.\) call/,
    );
  });
});

const ORDER_TRANSITIONS = (transition: string): string => `import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: {
    cancel: ${transition},
  } } } })],
});
`;

describe('transitions', () => {
  it('reads the source states named by from', () => {
    const [order] = read(ORDER_TRANSITIONS('{ from: [OrderStatus.pending] }')).declaration.lifecycles;

    expect(order?.fields[0]?.transitions).toEqual(new Map([['cancel', ['PENDING']]]));
  });

  it('reads a bare array as the same source states', () => {
    const fromObject = read(ORDER_TRANSITIONS('{ from: [OrderStatus.pending] }')).declaration.lifecycles[0]?.fields;
    const fromArray = read(ORDER_TRANSITIONS('[OrderStatus.pending]')).declaration.lifecycles[0]?.fields;

    expect(fromArray).toEqual(fromObject);
  });

  it('deprecates a bare array', () => {
    expect(read(ORDER_TRANSITIONS('[OrderStatus.pending]')).deprecations).toEqual([
      { line: 5, old: 'transitions.cancel: [...]', replacement: 'transitions.cancel: { from: [...] }' },
    ]);
  });

  it('does not deprecate from', () => {
    expect(read(ORDER_TRANSITIONS('{ from: [OrderStatus.pending] }')).deprecations).toEqual([]);
  });
});
