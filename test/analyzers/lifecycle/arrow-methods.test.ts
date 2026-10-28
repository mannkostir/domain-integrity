import { describe, expect, it } from 'vitest';
import { ClassDeclaration, SyntaxKind } from 'ts-morph';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { NO_BOOKKEEPING } from '../../../src/analyzers/lifecycle/bookkeeping';
import { candidateFields } from '../../../src/analyzers/lifecycle/candidates';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { instanceMethods } from '../../../src/analyzers/lifecycle/members';
import { LifecycleModel } from '../../../src/analyzers/lifecycle/model';
import { mutatingMethods } from '../../../src/analyzers/lifecycle/mutation';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';
import { methodOf } from '../../helpers/model';

type Files = Readonly<Record<string, string>>;

const CLOSE = `close(): void { if (this.status === 'closed') throw new Error('closed'); this.status = 'closed'; }`;

const REOPEN = `reopen = (): void => { this.status = 'open'; };`;

const GUARDED_REOPEN = `reopen(): void { if (this.status === 'closed') throw new Error('closed'); this.status = 'open'; }`;

const orderWith = (members: string, prelude = ''): Files => ({
  '/src/order.ts': `${prelude}
export type Status = 'open' | 'closed';
export class Order {
  private status: Status = 'open';
  ${members}
}
`,
});

const BASE_ORDER = (members: string): string => `
export type Status = 'open' | 'closed';
export class BaseOrder {
  protected status: Status = 'open';
  ${members}
}
`;

const derivedOrderWith = (baseMembers: string, members: string): Files => ({
  '/src/base.ts': BASE_ORDER(baseMembers),
  '/src/order.ts': `
import { BaseOrder } from './base';
export class Order extends BaseOrder {
  ${members}
}
`,
});

const orderClass = (files: Files): ClassDeclaration =>
  inMemoryProject(files).getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

const extracted = (files: Files, transitions?: ReadonlyMap<string, readonly string[]>): LifecycleModel => {
  const order = orderClass(files);
  return lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [
        { target: order, fields: [{ name: 'status', terminal: ['closed'], transitions, allowAfterTerminal: [] }], allowAfterTerminal: [] },
      ],
    },
    files: order.getProject().getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
};

const reported = (files: Files, transitions?: ReadonlyMap<string, readonly string[]>): readonly string[] => {
  const model = extracted(files, transitions);
  return [
    ...model.problems.map((problem) => problem.code),
    ...lifecycleAnalyzer.check(model).map((finding) => `${finding.ruleId} ${methodOf(finding) ?? ''}`),
  ];
};

const modelledMethod = (files: Files, name: string) =>
  extracted(files).aggregates[0]?.methods.find((method) => method.name === name);

const leaksThis = (files: Files): boolean => defaultScope(orderClass(files)).leaksThis;

const undeclaredOrder = (members: string): Files => ({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export type Status = 'open' | 'closed';
export class Order extends AggregateRoot<object> {
  private status: Status = 'open';
  ${members}
}
`,
});

const uncertainlyWritten = (files: Files): readonly string[] => {
  const project = inMemoryProject(files);
  const model = lifecycleAnalyzer.extract({
    declaration: DEFAULT_DECLARATION,
    files: project.getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return [...(model.aggregates[0]?.uncertainlyWritten ?? [])];
};

describe('arrow-function methods', () => {
  it('reports an unguarded public arrow method that can run in a terminal state', () => {
    expect(reported(orderWith(`${CLOSE}\n${REOPEN}`))).toEqual(['terminal-state-leak reopen']);
  });

  it('does not report an arrow method guarded against the terminal state', () => {
    expect(reported(orderWith(`close = (): void => { if (this.status === 'closed') throw new Error('closed'); this.status = 'closed'; };`))).toEqual([]);
  });

  it('reports transition drift when the guard of an arrow method disagrees with its transitions entry', () => {
    const files = orderWith(`close = (): void => { if (this.status === 'closed') throw new Error('closed'); this.status = 'closed'; };`);

    expect(reported(files, new Map([['close', ['closed']]]))).toEqual(['transition-drift close', 'transition-missing close']);
  });

  it('accepts a transitions entry that names an arrow method', () => {
    const files = orderWith(`close = (): void => { if (this.status === 'closed') throw new Error('closed'); this.status = 'closed'; };`);

    expect(reported(files, new Map([['close', ['open']]]))).toEqual([]);
  });

  it('judges an arrow method with an expression body', () => {
    expect(reported(orderWith(`${CLOSE}\nreopen = (): Status => (this.status = 'open');`))).toEqual(['terminal-state-leak reopen']);
  });

  it('judges an async arrow method like an async method', () => {
    const files = orderWith(`${CLOSE}\nreopen = async (): Promise<void> => { await Promise.resolve(); this.status = 'open'; };`);

    expect(reported(files)).toEqual(['terminal-state-leak reopen']);
  });

  it('records an arrow method at the line of its member', () => {
    expect(modelledMethod(orderWith(`${CLOSE}\n  ${REOPEN}`), 'reopen')?.line).toBe(6);
  });

  it('records a public arrow method as public', () => {
    expect(modelledMethod(orderWith(`${CLOSE}\n  ${REOPEN}`), 'reopen')?.visibility).toBe('public');
  });

  it('records a private arrow method as private', () => {
    expect(modelledMethod(orderWith(`${CLOSE}\n  private ${REOPEN}`), 'reopen')?.visibility).toBe('private');
  });

  it('records a protected arrow method as protected', () => {
    expect(modelledMethod(orderWith(`${CLOSE}\n  protected ${REOPEN}`), 'reopen')?.visibility).toBe('protected');
  });

  it('records a #name arrow method as private', () => {
    expect(modelledMethod(orderWith(`${CLOSE}\n  #${REOPEN}`), '#reopen')?.visibility).toBe('private');
  });

  it('does not report a private arrow method that can run in a terminal state', () => {
    expect(reported(orderWith(`${CLOSE}\nprivate ${REOPEN}`))).toEqual([]);
  });

  it('judges an arrow method declared in a project base class on the aggregate', () => {
    expect(reported(derivedOrderWith(REOPEN, CLOSE))).toEqual(['terminal-state-leak reopen']);
  });

  it('judges a subclass arrow property over the base method it shadows', () => {
    expect(reported(derivedOrderWith(GUARDED_REOPEN, `${CLOSE}\n${REOPEN}`))).toEqual(['terminal-state-leak reopen']);
  });

  it('judges a base arrow property over the subclass method of the same name', () => {
    expect(reported(derivedOrderWith(REOPEN, `${CLOSE}\n${GUARDED_REOPEN}`))).toEqual(['terminal-state-leak reopen']);
  });

  it('counts a call through super as a call', () => {
    expect(reported(derivedOrderWith(REOPEN, `${CLOSE}\nreopenAgain(): void { super.reopen(); }`))).toEqual(['terminal-state-leak reopen']);
  });

  it('still judges an arrow method that is only ever called', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}\nrun(): void { this['reopen'](); }`),
      '/src/use.ts': `
import { Order } from './order';
export const use = (order: Order): void => { order.reopen(); order.reopen?.(); (order.reopen)(); order.reopen!(); order['reopen'](); };
`,
    };

    expect(reported(files)).toEqual(['terminal-state-leak reopen']);
  });
});

describe('arrow-function properties that are not judged as methods', () => {
  it('skips a static arrow property', () => {
    expect(reported(orderWith(`${CLOSE}\nstatic reopen = (): void => { this.status = 'open'; };`))).toEqual([]);
  });

  it('skips a parenthesized arrow initializer', () => {
    expect(reported(orderWith(`${CLOSE}\nreopen = ((): void => { this.status = 'open'; });`))).toEqual([]);
  });

  it('skips an arrow initializer under an as assertion', () => {
    expect(reported(orderWith(`${CLOSE}\nreopen = ((): void => { this.status = 'open'; }) as () => void;`))).toEqual([]);
  });

  it('skips an arrow initializer under a satisfies operator', () => {
    expect(reported(orderWith(`${CLOSE}\nreopen = ((): void => { this.status = 'open'; }) satisfies () => void;`))).toEqual([]);
  });

  it('skips a decorated arrow property', () => {
    const prelude = 'const logged = (value: undefined, context: ClassFieldDecoratorContext): void => { void value; void context; };';

    expect(reported(orderWith(`${CLOSE}\n@logged ${REOPEN}`, prelude))).toEqual([]);
  });

  it('skips an arrow property reassigned in another file', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/patch.ts': `
import { Order } from './order';
export const patch = (order: Order): void => { order.reopen = (): void => undefined; };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property written through brackets', () => {
    expect(reported(orderWith(`${CLOSE}\n${REOPEN}\nconstructor() { this['reopen'] = (): void => undefined; }`))).toEqual([]);
  });

  it('skips an arrow property read as a value in another file', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const handlerOf = (order: Order): (() => void) => order.reopen;
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property read as a value through brackets', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const handlerOf = (order: Order): (() => void) => order['reopen'];
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property read through a keyof-typed element key', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const peek = (order: Order, key: keyof Order): unknown => order[key];
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property that is deleted', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const strip = (order: Partial<Order>): void => { delete order.reopen; };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property that is incremented', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
export const bump = (order: { reopen: number }): void => { order.reopen++; };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property that is a for-of target', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const cycle = (order: Order, handlers: readonly (() => void)[]): void => { for (order.reopen of handlers) order.reopen(); };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property passed as a callback', () => {
    const listen = 'listen(on: (handler: () => void) => void): void { on(this.reopen); }';

    expect(reported(orderWith(`${CLOSE}\n${REOPEN}\n${listen}`))).toEqual([]);
  });

  it('skips an arrow property that is bound', () => {
    const bound = 'bound(): () => void { return this.reopen.bind(this); }';

    expect(reported(orderWith(`${CLOSE}\n${REOPEN}\n${bound}`))).toEqual([]);
  });

  it('skips an arrow property taken by a destructuring declaration', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const use = (order: Order): void => { const { reopen } = order; reopen(); };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property taken by a destructuring assignment', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const use = (order: Order): void => { let run: () => void; ({ reopen: run } = order); run(); };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property taken by a destructured parameter', () => {
    const files = {
      ...orderWith(`${CLOSE}\n${REOPEN}`),
      '/src/use.ts': `
import { Order } from './order';
export const use = ({ reopen }: Order): void => { reopen(); };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('skips an arrow property whose name a base accessor shadows', () => {
    expect(reported(derivedOrderWith('get reopen(): () => void { return () => undefined; }', `${CLOSE}\n${REOPEN}`))).toEqual([]);
  });

  it('skips a subclass method whose name a base accessor shares', () => {
    const files = derivedOrderWith('get reopen(): () => void { return () => undefined; }', `${CLOSE}\nreopen(): void { this.status = 'open'; }`);

    expect(reported(files)).toEqual([]);
  });

  it('skips a base method that a subclass property not holding an arrow shadows', () => {
    const files = derivedOrderWith(`reopen(): void { this.status = 'open'; }`, `${CLOSE}\nreopen = noop;`);
    const withNoop = { ...files, '/src/order.ts': `const noop = (): void => undefined;\n${files['/src/order.ts']}` };

    expect(reported(withNoop)).toEqual([]);
  });

  it('skips a base method that a subclass parameter property shadows', () => {
    const files = derivedOrderWith(`reopen(): void { this.status = 'open'; }`, `${CLOSE}\nconstructor(readonly reopen: () => void) { super(); }`);

    expect(reported(files)).toEqual([]);
  });
});

describe('methodSources of an arrow method', () => {
  const order = orderClass(orderWith(`isOpen = (): boolean => this.status === 'open';\nreopen = (): Status => (this.status = 'open');`));
  const sourcesOf = (name: string) =>
    describeSources(
      methodSources(order.getPropertyOrThrow(name).getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction), resolvedField(order, 'status'), defaultScope(order)),
    );

  it('leaves the sources unknown when the expression body reads the field', () => {
    expect(sourcesOf('isOpen')).toBe('unknown');
  });

  it('lets an expression body that only assigns the field run from every state', () => {
    expect(sourcesOf('reopen')).toEqual(['closed', 'open']);
  });
});

describe('mutatingMethods with arrow methods', () => {
  it('counts a method that calls an arrow method assigning the aggregate', () => {
    const order = orderClass(orderWith(`private reopenNow = (): void => { this.status = 'open'; };\nreopen(): void { this.reopenNow(); }`));
    const methods = instanceMethods(order, [], defaultScope(order));

    expect([...mutatingMethods(methods, [], NO_BOOKKEEPING)].sort()).toEqual(['reopen', 'reopenNow']);
  });
});

describe('candidateFields with arrow methods', () => {
  it('proposes a nullable field that an arrow method sets', () => {
    const order = orderClass({
      '/src/order.ts': `
export class Order {
  private closedAt: Date | null = null;
  close = (): void => { this.closedAt = new Date(); };
}
`,
    });

    expect(candidateFields(defaultScope(order), []).map((field) => field.name)).toEqual(['closedAt']);
  });

  it('does not propose a nullable field that only a static arrow property sets', () => {
    const order = orderClass({
      '/src/order.ts': `
export class Order {
  private closedAt: Date | null = null;
  static close = (): void => { this.closedAt = new Date(); };
}
`,
    });

    expect(candidateFields(defaultScope(order), [])).toEqual([]);
  });
});

describe('uncertain writes with arrow methods', () => {
  it('treats a write inside an arrow method as a certain write', () => {
    expect(uncertainlyWritten(undeclaredOrder(`close = (): void => { this.status = 'closed'; };`))).toEqual([]);
  });

  it('treats this escaping inside an arrow method as a modelled escape', () => {
    const members = `close = (): void => { this.status = 'closed'; };\nregister = (registry: Set<object>): void => { registry.add(this); };`;

    expect(uncertainlyWritten(undeclaredOrder(members))).toEqual([]);
  });
});

describe('this-leak with arrow methods', () => {
  const HELPER_C = 'helperC(): Status { return this.status; }';
  const OPEN_NOW = `private openNow = (): void => { this.status = 'open'; };`;

  it('does not count an arrow method as capturing the aggregate', () => {
    expect(leaksThis(orderWith(OPEN_NOW))).toBe(false);
  });

  it('judges a method reading a project field when the only capture of this is an arrow method', () => {
    const files = orderWith(`${CLOSE}\n${OPEN_NOW}\nprivate note = { text: '' };\nannotate(text: string): void { this.note.text = text; }`);

    expect(reported(files)).toEqual(['terminal-state-leak annotate']);
  });

  it('judges a method that calls an arrow method not touching the field', () => {
    const files = orderWith(`${CLOSE}\nprivate note = '';\nprivate touch = (): void => { this.note = 'reopened'; };\nreopen(): void { this.touch(); this.status = 'open'; }`);

    expect(reported(files)).toEqual(['terminal-state-leak reopen']);
  });

  it('counts a capturing arrow nested inside an arrow method', () => {
    const later = `private openLater = (schedule: (run: () => void) => void): void => { schedule(() => { this.status = 'open'; }); };`;

    expect(leaksThis(orderWith(later))).toBe(true);
  });

  it('does not count an array callback nested inside an arrow method', () => {
    const counted = `private countOpen = (orders: readonly string[]): number => orders.filter(() => this.status === 'open').length;`;

    expect(leaksThis(orderWith(counted))).toBe(false);
  });

  it('counts an arrow property read as a value', () => {
    const listen = `listen(emitter: { on(event: string, handler: () => void): void }): void { emitter.on('x', this.reopen); }`;

    expect(leaksThis(orderWith(`${REOPEN}\n${listen}`))).toBe(true);
  });

  it('counts an object spread of this when the family has an arrow method', () => {
    expect(leaksThis(orderWith(`${OPEN_NOW}\nsnapshot(): object { return { ...this }; }`))).toBe(true);
  });

  it('counts a wrapped object spread of this when the family has an arrow method', () => {
    expect(leaksThis(orderWith(`${OPEN_NOW}\nsnapshot(): object { return { ...(this as object) }; }`))).toBe(true);
  });

  it('counts an object spread of this when an arrow method is declared in a base class', () => {
    expect(leaksThis(derivedOrderWith(OPEN_NOW, `snapshot(): object { return { ...this }; }`))).toBe(true);
  });

  it('does not count an object spread of this when no arrow method captures this', () => {
    expect(leaksThis(orderWith(`noop = (): void => undefined;\nsnapshot(): object { return { ...this }; }`))).toBe(false);
  });

  it('counts an object spread of this when only a parameter default of an arrow method captures this', () => {
    expect(leaksThis(orderWith(`peek = (status: Status = this.status): Status => status;\nsnapshot(): object { return { ...this }; }`))).toBe(true);
  });

  it('does not count an object spread of this when the only this in an arrow method is a nested function', () => {
    const inner = `noop = (): (() => unknown) => function (this: unknown) { return this; };`;

    expect(leaksThis(orderWith(`${inner}\nsnapshot(): object { return { ...this }; }`))).toBe(false);
  });

  it('does not count an object spread of this when the family has no arrow method', () => {
    expect(leaksThis(orderWith(`${GUARDED_REOPEN}\nsnapshot(): object { return { ...this }; }`))).toBe(false);
  });

  it('counts an object spread of this when an arrow method uses super', () => {
    const files = derivedOrderWith(HELPER_C, `peekC = (): string => super.helperC();\nsnapshot(): object { return { ...this }; }`);

    expect(leaksThis(files)).toBe(true);
  });

  it('does not count an object spread of this when an arrow method of a derived aggregate uses neither this nor super', () => {
    const files = derivedOrderWith(HELPER_C, `peekC = (): string => 'open';\nsnapshot(): object { return { ...this }; }`);

    expect(leaksThis(files)).toBe(false);
  });

  it('counts an arrow nested inside an arrow method that uses super', () => {
    const later = `private openLater = (schedule: (run: () => void) => void): void => { schedule(() => { super.helperC(); }); };`;

    expect(leaksThis(derivedOrderWith(HELPER_C, later))).toBe(true);
  });

  it('does not count an object spread of this.props when the family has an arrow method', () => {
    expect(leaksThis(orderWith(`private props = { note: '' };\n${OPEN_NOW}\nsnapshot(): object { return { ...this.props }; }`))).toBe(false);
  });

  it('does not count a factory arrow method that returns its new instance', () => {
    expect(leaksThis(orderWith(`clone = (): Order => { const copy = new Order(); return copy; };`))).toBe(false);
  });

  it('counts a factory arrow method that captures its new instance in a closure', () => {
    expect(leaksThis(orderWith(`clone = (): (() => Order) => { const copy = new Order(); return () => copy; };`))).toBe(true);
  });

  it('counts a factory arrow method that spreads its new instance when an arrow method captures this', () => {
    expect(leaksThis(orderWith(`clone = (): object => { const copy = new Order(); return { ...copy }; };\n${OPEN_NOW}`))).toBe(true);
  });

  it('does not count a factory arrow method that spreads its new instance when no arrow method captures this', () => {
    expect(leaksThis(orderWith(`clone = (): object => { const copy = new Order(); return { ...copy }; };`))).toBe(false);
  });

  it('does not count a factory method that spreads its new instance when the family has no arrow method', () => {
    expect(leaksThis(orderWith(`clone(): object { const copy = new Order(); return { ...copy }; }`))).toBe(false);
  });
});

describe('object spread of this with arrow methods', () => {
  const META = 'class Meta { tags: string[] = []; }';
  const ARCHIVE = `private meta: Meta = new Meta();\nsnapshot(): object { return { ...this }; }\narchive(): void { if (this.meta.tags.length > 3) return; this.status = 'closed'; }`;

  it('judges a method reading a project field when the spread arrow method does not capture this', () => {
    expect(reported(orderWith(`noopSp = (): void => {};\n${ARCHIVE}`, META))).toEqual(['terminal-state-leak archive']);
  });

  it('skips a method reading a project field when the spread arrow method captures this', () => {
    expect(reported(orderWith(`noopSp = (): Status => this.status;\n${ARCHIVE}`, META))).toEqual([]);
  });
});

describe('assertion helpers held in arrow methods', () => {
  const ASSERT_OPEN = `private assertOpen = (): void => { if (this.status !== 'open') throw new Error('not open'); };`;
  const callerSources = (files: Files) => {
    const order = orderClass(files);
    return describeSources(methodSources(order.getMethodOrThrow('close'), resolvedField(order, 'status'), defaultScope(order)));
  };
  const closeAfter = (helper: string): Files => orderWith(`${helper}\nclose(): void { this.assertOpen(); this.status = 'closed'; }`);

  it('narrows the caller of an arrow helper to the states the helper lets through', () => {
    expect(callerSources(closeAfter(ASSERT_OPEN))).toEqual(['open']);
  });

  it('computes transition drift from the guard of an arrow helper', () => {
    expect(reported(closeAfter(ASSERT_OPEN), new Map([['close', ['closed']]]))).toEqual(['transition-drift close', 'transition-missing close']);
  });

  it('does not follow an async arrow helper', () => {
    const helper = `private assertOpen = async (): Promise<void> => { if (this.status !== 'open') throw new Error('not open'); };`;

    expect(callerSources(closeAfter(helper))).toBe('unknown');
  });

  it('does not follow an arrow helper with an expression body', () => {
    const helper = `private assertOpen = (): void => Order.failUnless(this.status === 'open');\nstatic failUnless(open: boolean): void { if (!open) throw new Error('not open'); }`;

    expect(callerSources(closeAfter(helper))).toBe('unknown');
  });

  it('does not follow an arrow helper read as a value elsewhere', () => {
    const files = {
      ...closeAfter(ASSERT_OPEN),
      '/src/use.ts': `
export const take = (order: { assertOpen: () => void }): (() => void) => order.assertOpen;
`,
    };

    expect(callerSources(files)).toBe('unknown');
  });

  it('follows a base arrow helper over the subclass method of the same name', () => {
    const base = `cancel = (): void => { if (this.status === 'closed') throw new Error('closed'); };`;
    const members = `private note = '';\ncancel(): void { this.note = 'cancelled'; }\nclose(): void { this.cancel(); this.status = 'closed'; }`;

    expect(reported(derivedOrderWith(base, members))).toEqual([]);
  });

  it('reads through a base arrow method over the subclass method of the same name', () => {
    const base = `label = (): string => this.status;`;
    const members = `label(): string { return 'order'; }\nclose(): void { const shown = this.label(); this.status = 'closed'; }`;

    expect(callerSources(derivedOrderWith(base, members))).toBe('unknown');
  });
});
