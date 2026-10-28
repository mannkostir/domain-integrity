import { describe, expect, it } from 'vitest';
import { ClassDeclaration, CompilerOptions, ScriptTarget } from 'ts-morph';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';
import { methodOf } from '../../helpers/model';

type Files = Readonly<Record<string, string>>;

const ORDER_FILE = '/src/order.ts';

const aggregateClass = (files: Files, name: string, compilerOptions: CompilerOptions = {}): ClassDeclaration =>
  inMemoryProject(files, compilerOptions).getSourceFileOrThrow(ORDER_FILE).getClassOrThrow(name);

type Transitions = ReadonlyMap<string, readonly string[]>;

const reported = (
  files: Files,
  name = 'Order',
  compilerOptions: CompilerOptions = {},
  transitions: Transitions | undefined = undefined,
): readonly string[] => {
  const target = aggregateClass(files, name, compilerOptions);
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: target.getProject().getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return [
    ...model.problems.map((problem) => problem.code),
    ...lifecycleAnalyzer.check(model).map((finding) => `${finding.ruleId} ${methodOf(finding) ?? ''}`),
  ];
};

const orderWith = (members: string): Files => ({
  [ORDER_FILE]: `
export type Status = 'open' | 'closed';
export class Order {
  private status: Status = 'open';
  ${members}
}
`,
});

const CANCEL = `cancel(): void { this.status = 'closed'; }`;

describe('methods whose name is written', () => {
  it('does not judge a method that an own property assigned in the constructor shadows', () => {
    expect(reported(orderWith(`constructor() { this.cancel = (): void => {}; }\n${CANCEL}`))).toEqual([]);
  });

  it('judges a method whose name is never written', () => {
    expect(reported(orderWith(CANCEL))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method when only a different name is written', () => {
    expect(reported(orderWith(`private note = '';\nconstructor() { this.note = 'new'; }\n${CANCEL}`))).toEqual(['terminal-state-leak cancel']);
  });

  it('does not judge a method replaced on the prototype', () => {
    const files = {
      ...orderWith(CANCEL),
      '/src/patch.ts': `
import { Order } from './order';
Order.prototype.cancel = function (): void {};
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('does not judge a method written through brackets in another file', () => {
    const files = {
      ...orderWith(CANCEL),
      '/test/order.spec.ts': `
import { Order } from '../src/order';
export const stub = (order: Order): void => { order['cancel'] = (): void => undefined; };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('does not trace a caller into a method whose name is written', () => {
    const members = `private note = '';\nconstructor() { this.touch = (): void => {}; }\ntouch(): void { this.note = 'touched'; }\nclose(): void { this.touch(); this.status = 'closed'; }`;

    expect(reported(orderWith(members))).toEqual([]);
  });

  it('does not follow an assertion helper whose name is written', () => {
    const helper = `assertOpen(): void { if (this.status !== 'open') throw new Error('not open'); }`;
    const order = aggregateClass(orderWith(`constructor() { this.assertOpen = (): void => {}; }\n${helper}\nclose(): void { this.assertOpen(); this.status = 'closed'; }`), 'Order');

    expect(describeSources(methodSources(order.getMethodOrThrow('close'), resolvedField(order, 'status'), defaultScope(order)))).toBe('unknown');
  });
});

const withSource = (source: string): Files => ({
  ...orderWith(CANCEL),
  '/src/other.ts': `
import { Order } from './order';
${source}
`,
});

const SPECIAL_ORDER = 'export class SpecialOrder extends Order {}';

const CANCEL_DTO = 'export class CancelDto { cancel: boolean; constructor(cancel: boolean) { this.cancel = cancel; } }';

const SOCKET = 'export class Socket { cancel(): void {} send(data: string): void { void data; } }';

describe('writes of a method name on a receiver that may be the aggregate', () => {
  it('does not judge a method assigned through a variable typed as the aggregate', () => {
    expect(reported(withSource('export const stub = (order: Order): void => { order.cancel = (): void => undefined; };'))).toEqual([]);
  });

  it('does not judge a method assigned through an interface the aggregate implements', () => {
    const source = `export interface Cancellable { cancel(): void }
export const stub = (order: Order): void => { const target: Cancellable = order; target.cancel = (): void => undefined; };`;

    expect(reported(withSource(source))).toEqual([]);
  });

  it('does not judge a method assigned through any', () => {
    expect(reported(withSource('export const stub = (target: any): void => { target.cancel = (): void => undefined; };'))).toEqual([]);
  });

  it('does not judge a method assigned through a type parameter whose constraint the aggregate satisfies', () => {
    const source = 'export const stub = <T extends { cancel(): void }>(target: T): void => { target.cancel = (): void => undefined; };';

    expect(reported(withSource(source))).toEqual([]);
  });

  it('does not judge a method assigned through an unconstrained type parameter', () => {
    expect(reported(withSource('export const stub = <T,>(target: T): void => { target.cancel = (): void => undefined; };'))).toEqual([]);
  });

  it('does not judge a method assigned through a record type', () => {
    const source = 'export const stub = (bag: Record<string, unknown>): void => { bag.cancel = (): void => undefined; };';

    expect(reported(withSource(source))).toEqual([]);
  });

  it('does not judge a method assigned through a variable typed as a subclass', () => {
    const source = `${SPECIAL_ORDER}\nexport const stub = (order: SpecialOrder): void => { order.cancel = (): void => undefined; };`;

    expect(reported(withSource(source))).toEqual([]);
  });

  it('does not judge a method assigned through super in a subclass', () => {
    const source = 'export class SpecialOrder extends Order { constructor() { super(); super.cancel = (): void => undefined; } }';

    expect(reported(withSource(source))).toEqual([]);
  });

  it('does not judge a method written through a keyof key on the aggregate', () => {
    const source = 'export const set = (order: Order, key: keyof Order, value: never): void => { order[key] = value; };';

    expect(reported(withSource(source))).toEqual([]);
  });

  it('judges a method whose name an unrelated class assigns on this', () => {
    expect(reported(withSource(CANCEL_DTO))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method whose name is assigned on an unrelated class type', () => {
    const source = `${SOCKET}\nexport const stub = (socket: Socket): void => { socket.cancel = (): void => undefined; };`;

    expect(reported(withSource(source))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method whose name is assigned on an object type the aggregate does not satisfy', () => {
    const source = 'export const stub = (options: { cancel?: () => void; timeoutMs: number }): void => { options.cancel = (): void => undefined; };';

    expect(reported(withSource(source))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method whose name is assigned through a type parameter constrained to an unrelated class', () => {
    const source = `${SOCKET}\nexport const stub = <T extends Socket>(socket: T): void => { socket.cancel = (): void => undefined; };`;

    expect(reported(withSource(source))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method whose name is written through a keyof key on an unrelated class', () => {
    const source = `${CANCEL_DTO}\nexport const set = (dto: CancelDto, key: keyof CancelDto, value: never): void => { dto[key] = value; };`;

    expect(reported(withSource(source))).toEqual(['terminal-state-leak cancel']);
  });

  it('traces a caller into a method whose name only an unrelated class assigns', () => {
    const members = `private note = '';\ntouch(): void { this.note = 'touched'; }\nclose(): void { this.touch(); this.status = 'closed'; }`;
    const files = { ...orderWith(members), '/src/other.ts': 'export class TouchDto { touch: boolean; constructor(touch: boolean) { this.touch = touch; } }' };

    expect(reported(files)).toEqual(['terminal-state-leak touch', 'terminal-state-leak close']);
  });

  it('follows an assertion helper whose name only an unrelated class assigns', () => {
    const helper = `assertOpen(): void { if (this.status !== 'open') throw new Error('not open'); }`;
    const files = {
      ...orderWith(`${helper}\nclose(): void { this.assertOpen(); this.status = 'closed'; }`),
      '/src/other.ts': 'export class AssertDto { assertOpen: boolean; constructor(assertOpen: boolean) { this.assertOpen = assertOpen; } }',
    };
    const order = aggregateClass(files, 'Order');

    expect(describeSources(methodSources(order.getMethodOrThrow('close'), resolvedField(order, 'status'), defaultScope(order)))).toEqual(['open']);
  });
});

const baseAndOrder = (members: string): Files => ({
  [ORDER_FILE]: `
export type Status = 'open' | 'closed';
const noop = (): void => undefined;
export class BangBase {
  protected status: Status = 'open';
  cancelBg(): void { this.status = 'closed'; }
}
export class BangOrder extends BangBase {
  ${members}
}
`,
});

describe('properties that set nothing on the instance', () => {
  it('judges an inherited method that a declare property names', () => {
    const files = {
      [ORDER_FILE]: `
export type Status = 'open' | 'closed';
export class DcBase {
  protected status: Status = 'open';
  cancelDc(): void { this.status = 'closed'; }
}
export class DcOrder extends DcBase {
  declare cancelDc: () => void;
}
`,
    };

    expect(reported(files, 'DcOrder')).toEqual(['terminal-state-leak cancelDc']);
  });

  it('judges an inherited method that an abstract property in a middle class names', () => {
    const files = {
      [ORDER_FILE]: `
export type Status = 'open' | 'closed';
export class AbBase {
  protected status: Status = 'open';
  cancelAb(): void { this.status = 'closed'; }
}
export abstract class AbMiddle extends AbBase {
  abstract cancelAb: () => void;
}
export class AbOrder extends AbMiddle {}
`,
    };

    expect(reported(files, 'AbOrder')).toEqual(['terminal-state-leak cancelAb']);
  });

  it('judges an inherited method that an uninitialised property names when class fields are assigned', () => {
    expect(reported(baseAndOrder('cancelBg!: () => void;'), 'BangOrder', { useDefineForClassFields: false })).toEqual([
      'terminal-state-leak cancelBg',
    ]);
  });

  it('judges an inherited method that an optional property names when class fields are assigned', () => {
    expect(reported(baseAndOrder('cancelBg?: () => void;'), 'BangOrder', { useDefineForClassFields: false })).toEqual([
      'terminal-state-leak cancelBg',
    ]);
  });

  it('judges an inherited method that an uninitialised property names when the target predates ES2022', () => {
    expect(reported(baseAndOrder('cancelBg!: () => void;'), 'BangOrder', { target: ScriptTarget.ES2021 })).toEqual([
      'terminal-state-leak cancelBg',
    ]);
  });

  it('skips an inherited method that an uninitialised property shadows when class fields are defined', () => {
    expect(reported(baseAndOrder('cancelBg!: () => void;'), 'BangOrder', { useDefineForClassFields: true })).toEqual([]);
  });

  it('skips an inherited method that an uninitialised property shadows under an ES2022 target', () => {
    expect(reported(baseAndOrder('cancelBg!: () => void;'), 'BangOrder', { target: ScriptTarget.ES2022 })).toEqual([]);
  });

  it('skips an inherited method that an uninitialised property shadows under the default target', () => {
    expect(reported(baseAndOrder('cancelBg!: () => void;'), 'BangOrder', { target: undefined })).toEqual([]);
  });

  it('skips an inherited method that an initialised property shadows when class fields are assigned', () => {
    expect(reported(baseAndOrder('cancelBg = noop;'), 'BangOrder', { useDefineForClassFields: false })).toEqual([]);
  });
});

const GUARDED_CANCEL = `cancel(): void { if (this.status !== 'open') throw new Error('not open'); this.status = 'closed'; }`;

const FROM_CLOSED: Transitions = new Map([['cancel', ['closed']]]);

describe('transitions entries for methods that are not judged', () => {
  it('reports a judged method whose guard disagrees with its transitions entry', () => {
    expect(reported(orderWith(GUARDED_CANCEL), 'Order', {}, FROM_CLOSED)).toEqual(['transition-drift cancel', 'transition-missing cancel']);
  });

  it('accepts and leaves unjudged an entry for a method whose name is written elsewhere', () => {
    const files = {
      ...orderWith(GUARDED_CANCEL),
      '/test/order.spec.ts': `
import { Order } from '../src/order';
export const stub = (order: Order): void => { order['cancel'] = (): void => undefined; };
`,
    };

    expect(reported(files, 'Order', {}, FROM_CLOSED)).toEqual([]);
  });

  it('accepts and leaves unjudged an entry for an arrow property read as a value', () => {
    const files = {
      ...orderWith(`cancel = (): void => { if (this.status !== 'open') throw new Error('not open'); this.status = 'closed'; };`),
      '/src/use.ts': `
import { Order } from './order';
export const handlerOf = (order: Order): (() => void) => order.cancel;
`,
    };

    expect(reported(files, 'Order', {}, FROM_CLOSED)).toEqual([]);
  });

  it('accepts an entry for a method declared in a project base class', () => {
    const files = {
      '/src/base.ts': `
export type Status = 'open' | 'closed';
export class BaseOrder {
  protected status: Status = 'open';
  ${GUARDED_CANCEL}
}
`,
      [ORDER_FILE]: `
import { BaseOrder } from './base';
export class Order extends BaseOrder {
  constructor() { super(); this.cancel = (): void => undefined; }
}
`,
    };

    expect(reported(files, 'Order', {}, FROM_CLOSED)).toEqual([]);
  });

  it('reports an entry whose name is declared nowhere as a missing method', () => {
    expect(reported(orderWith(GUARDED_CANCEL), 'Order', {}, new Map([['archive', ['open']]]))).toEqual(['transition-method-missing']);
  });

  it('reports an entry naming a property that does not hold an arrow function as a missing method', () => {
    expect(reported(orderWith(`${GUARDED_CANCEL}\nprivate note = '';`), 'Order', {}, new Map([['note', ['open']]]))).toEqual([
      'transition-method-missing',
    ]);
  });
});

const undeclaredOrderWith = (members: string): Files => ({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  [ORDER_FILE]: `
import { AggregateRoot } from './aggregate-root';
export type Status = 'open' | 'closed';
export class Order extends AggregateRoot<object> {
  private status: Status = 'open';
  private closedAt: Date | null = null;
  ${members}
}
`,
});

const undeclaredModel = (files: Files) => {
  const project = inMemoryProject(files);
  return lifecycleAnalyzer.extract({
    declaration: DEFAULT_DECLARATION,
    files: project.getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
};

const undeclaredOrder = (files: Files) => undeclaredModel(files).aggregates.find((aggregate) => aggregate.name === 'Order');

const uncertainlyWritten = (files: Files): readonly string[] => [...(undeclaredOrder(files)?.uncertainlyWritten ?? [])];

const suggestedTerminals = (files: Files): ReadonlyMap<string, readonly string[]> => {
  const order = lifecycleAnalyzer.suggest(undeclaredModel(files)).find((suggestion) => suggestion.className === 'Order');
  return new Map(order?.fields.map(({ field, terminal }) => [field.name, terminal.map((value) => value.token)]));
};

const stubbing = (name: string): Files => ({
  '/test/order.spec.ts': `
import { Order } from '../src/order';
export const stub = (order: Order): void => { order.${name} = (): never => { throw new Error('stub'); }; };
`,
});

const CLOSE_NOW = `close(): void { this.status = 'closed'; this.closedAt = new Date(); }`;

describe('suggestions for an aggregate with a method whose name is written', () => {
  it('treats a write inside such a method as a certain write', () => {
    expect(uncertainlyWritten({ ...undeclaredOrderWith(CANCEL), ...stubbing('cancel') })).toEqual([]);
  });

  it('treats this escaping inside such a method as a modelled escape', () => {
    const files = { ...undeclaredOrderWith(`cancel(): Order { this.status = 'closed'; return this; }`), ...stubbing('cancel') };

    expect(uncertainlyWritten(files)).toEqual([]);
  });

  it('still treats a write inside a base method that a property shadows as uncertain', () => {
    const files = {
      '/src/aggregate-root.ts': AGGREGATE_ROOT,
      '/src/base.ts': `
import { AggregateRoot } from './aggregate-root';
export type Status = 'open' | 'closed';
export class BaseOrder extends AggregateRoot<object> {
  protected status: Status = 'open';
  ${CANCEL}
}
`,
      [ORDER_FILE]: `
import { BaseOrder } from './base';
const noop = (): void => undefined;
export class Order extends BaseOrder {
  cancel: () => void = noop;
}
`,
    };

    expect(uncertainlyWritten(files)).toEqual(['status']);
  });

  it('suggests the terminal value that such a method sets', () => {
    const files = { ...undeclaredOrderWith(`cancel(): Order { this.status = 'closed'; return this; }`), ...stubbing('cancel') };

    expect(suggestedTerminals(files).get('status')).toEqual(['closed']);
  });

  it('keeps the terminal value of a timestamp that only such a method sets', () => {
    const files = { ...undeclaredOrderWith(`${CLOSE_NOW}\nstamp(): void { this.closedAt = new Date(); }`), ...stubbing('stamp') };

    expect(suggestedTerminals(files).get('closedAt')).toEqual(['set']);
  });
});
