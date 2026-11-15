import { describe, expect, it } from 'vitest';
import { setsOf } from '../../../src/analyzers/lifecycle/assigned';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { defaultScope, describeAssigned, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const analyse = (body: string, setter = 'this.status = value;', members = '', destination = "status: 'pending' | 'paid' | 'cancelled' = 'pending';") => {
  const project = inMemoryProject({ '/src/order.ts': `
    class Order {
      ${destination}
      title = '';
      get state(): string { return this.status; }
      set state(value: 'pending' | 'paid' | 'cancelled') { ${setter} }
      ${members}
      close(value: 'pending' | 'paid' | 'cancelled', flag: boolean): void { ${body} }
    }
  ` });
  const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');
  const method = cls.getMethodOrThrow('close');
  const field = resolvedField(cls, 'status');
  return {
    sources: describeSources(methodSources(method, field, defaultScope(cls))),
    sets: describeAssigned(setsOf(method, field)),
  };
};

const guard = "if (this.status === 'paid') return;";

describe('transparent state setter cutoff', () => {
  it.each(["'cancelled'", 'value'])('preserves the entry guard for %s', (value) => {
    expect(analyse(`${guard} this.state = ${value};`).sources).toEqual(['cancelled', 'pending']);
  });

  it('substitutes the caller value into the assignment facts', () => {
    expect(analyse(`${guard} this.state = 'cancelled';`).sets).toEqual({ tokens: ['cancelled'], unresolved: false, mayWrite: false });
  });

  it('retains unresolved caller values', () => {
    expect(analyse(`${guard} this.state = value;`).sets).toEqual({ tokens: [], unresolved: true, mayWrite: false });
  });

  it('uses a constant setter value instead of the caller value', () => {
    expect(analyse("this.state = 'pending';", "this.status = 'cancelled';").sets.tokens).toEqual(['cancelled']);
  });

  it('excludes guards after the overwrite', () => {
    expect(analyse(`this.state = 'cancelled'; ${guard}`).sources).toEqual(['cancelled', 'paid', 'pending']);
  });

  it('retains state reads on the outer assignment right hand side', () => {
    expect(analyse(`${guard} this.state = this.status;`).sources).toBe('unknown');
  });

  it('does not apply a later guard to a preceding conditional write', () => {
    expect(analyse(`if (flag) this.state = 'pending'; ${guard} this.title = 'x';`).sources).toBe('unknown');
  });

  it.each([
    `if (this.status !== 'paid') { this.state = 'cancelled'; if (this.status === 'cancelled') return; }`,
    `switch (this.status) { case 'pending': this.state = 'cancelled'; if (this.status === 'cancelled') return; break; }`,
  ])('matches direct assignment in a wrapper: %s', (body) => {
    expect(analyse(body).sources).toEqual(analyse(body.replaceAll('this.state =', 'this.status =')).sources);
  });

  it.each([
    `${guard} this.status = value;`,
    'this.status = value; this.title = value;',
    'this.status = this.status;',
    'this.status = this.next;',
    'this.status = consume(value);',
    'this.state = value;',
    'if (value) this.status = value;',
    'this.store(value);',
  ])('keeps a nontransparent setter unknown: %s', (setter) => {
    expect(analyse(`this.state = 'cancelled';`, setter, "get next() { return this.status; } other = ''; store(value: string) { this.status = 'paid'; }").sources).toBe('unknown');
  });

  it('does not cut off a later guard for an unrelated destination', () => {
    expect(analyse(`this.state = 'cancelled'; ${guard}`, 'this.title = value;').sources).toEqual(['cancelled', 'pending']);
  });

  it.each(['+=', '||=', '&&=', '??='])('does not give %s a plain assignment cutoff', (operator) => {
    expect(analyse(`${guard} this.state ${operator} 'cancelled';`).sources).toBe('unknown');
  });

  it('keeps a props setter writing a different same-named field unknown', () => {
    expect(analyse("this.state = 'cancelled';", 'this.props.status = value;', "props: { status: 'pending' | 'paid' | 'cancelled' } = { status: 'pending' };").sources).toBe('unknown');
  });
});

const sourceFacts = (source: string, owner = 'Order') => {
  const project = inMemoryProject({ '/src/order.ts': source });
  const file = project.getSourceFileOrThrow('/src/order.ts');
  const cls = file.getClassOrThrow('Order');
  const method = file.getClassOrThrow(owner).getMethodOrThrow('close');
  const field = resolvedField(cls, 'status');
  return {
    sources: describeSources(methodSources(method, field, defaultScope(cls))),
    sets: describeAssigned(setsOf(method, field, cls)),
  };
};

const status = "status: 'pending' | 'paid' | 'cancelled' = 'pending';";
const setter = "set state(value: 'pending' | 'paid' | 'cancelled') { this.status = value; }";
const close = `close() { ${guard} this.state = 'cancelled'; }`;

describe('resolved state setter destinations', () => {
  it('resolves an inherited setter against the derived instance', () => {
    expect(sourceFacts(`class Base { ${status} ${setter} } class Order extends Base { ${close} }`).sources).toEqual(['cancelled', 'pending']);
  });

  it('extracts assignment facts from an inherited method', () => {
    expect(sourceFacts(`class Base { ${status} ${setter} ${close} } class Order extends Base {}`, 'Base').sets.tokens).toEqual(['cancelled']);
  });

  it('resolves an explicit super setter despite a derived getter', () => {
    expect(sourceFacts(`class Base { ${status} ${setter} } class Order extends Base {
      get state() { return this.status; }
      close() { ${guard} super.state = 'cancelled'; }
    }`).sources).toEqual(['cancelled', 'pending']);
  });

  it('uses the instance setter despite a static namesake', () => {
    expect(sourceFacts(`class Order { ${status} static set state(value: string) {} ${setter} ${close} }`).sources).toEqual(['cancelled', 'pending']);
  });

  it('resolves a private setter by its lexical identity', () => {
    expect(sourceFacts(`class Order { ${status} ${setter.replace('state(', '#state(')} ${close.replace('this.state', 'this.#state')} }`).sources).toEqual(['cancelled', 'pending']);
  });

  it('supports a literal element access', () => {
    expect(sourceFacts(`class Order { ${status} ${setter} ${close.replace('this.state', "(this['state'])")} }`).sets.tokens).toEqual(['cancelled']);
  });

  it('proves a plain props destination', () => {
    expect(sourceFacts(`class Order {
      props: { status: 'pending' | 'paid' | 'cancelled' } = { status: 'pending' };
      ${setter.replace('this.status', 'this.props.status')}
      ${close.replaceAll('this.status', 'this.props.status')}
    }`).sources).toEqual(['cancelled', 'pending']);
  });

  it.each([
    ['decorated setter', `class Order { ${status} ${setter.replace('set state', '@decorate set state')} ${close} }`],
    ['decorated class', `@decorate class Order { ${status} ${setter} ${close} }`],
    ['computed declaration', `class Order { ${status} ${setter} set [key](value: string) {} ${close} }`],
    ['getter only', `class Order { ${status} get state() { return this.status; } ${close} }`],
    ['unresolved setter', `class Order { ${status} declare set state(value: string); ${close} }`],
    ['unresolved base', `class Order extends Missing { ${status} ${setter} ${close} }`],
    ['cyclic base', `class Base extends Order {} class Order extends Base { ${status} ${setter} ${close} }`],
    ['shadowed data', `class Base { ${status} ${setter} } class Order extends Base { state = ''; ${close} }`],
    ['nested destination', `class Order { ${status} nested = { status: 'pending' }; set state(value: string) { this.nested.status = value; if (this.status === 'paid') return; } ${close} }`],
    ['effectful props', `class Order {
      get props(): { status: 'pending' | 'paid' | 'cancelled' } { if (this.status === 'paid') throw new Error(); return { status: 'pending' }; }
      ${status} ${setter.replace('this.status', 'this.props.status')} ${close}
    }`],
  ])('keeps %s unknown', (_name, source) => {
    expect(sourceFacts(source).sources).toBe('unknown');
  });

  it('keeps a shadowed props holder unknown', () => {
    expect(sourceFacts(`class Base {
      props: { status: 'pending' | 'paid' | 'cancelled' } = { status: 'pending' };
      ${setter.replace('this.status', 'this.props.status')}
    } class Order extends Base {
      get props(): { status: 'pending' | 'paid' | 'cancelled' } { throw new Error(); }
      ${close.replaceAll('this.status', 'this.props.status')}
    }`).sources).toBe('unknown');
  });

  it('retains unknown assignment facts for an unproven setter', () => {
    expect(analyse("this.state = 'cancelled';", `${guard} this.status = value;`).sets.unresolved).toBe(true);
  });
});

describe('state setter update facts', () => {
  it.each(['this.state++;', '--this.state;'])('keeps %s uncertain', (statement) => {
    expect(analyse(statement).sets.mayWrite).toBe(true);
  });
});

describe('state setter writes inside exits', () => {
  it('does not hide a read beside a setter write in an exit expression', () => {
    expect(analyse("if (this.status === 'paid') return [this.status, this.state = 'cancelled']; this.title = 'x';").sources).toBe('unknown');
  });

  it('matches a direct write inside an exit expression', () => {
    const body = "if (this.status === 'paid') return void (this.state = 'cancelled'); this.title = 'x';";

    expect(analyse(body).sources).toEqual(analyse(body.replace('this.state =', 'this.status =')).sources);
  });
});

describe('state setter proof boundaries', () => {
  it('keeps a library setter unjudged', () => {
    const project = inMemoryProject({
      '/node_modules/vendor/index.d.ts': `export declare class Base {
        status: 'pending' | 'paid' | 'cancelled';
        set state(value: 'pending' | 'paid' | 'cancelled');
      }`,
      '/src/order.ts': `import { Base } from '../node_modules/vendor/index';
        class Order extends Base { ${close} }`,
    });
    const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

    expect(describeSources(methodSources(cls.getMethodOrThrow('close'), resolvedField(cls, 'status'), defaultScope(cls)))).toBe('unknown');
  });

  it('does not prove a library data destination transparent', () => {
    const project = inMemoryProject({
      '/node_modules/vendor/index.d.ts': `export declare class Base { status: 'pending' | 'paid' | 'cancelled'; }`,
      '/src/order.ts': `import { Base } from '../node_modules/vendor/index';
        class Order extends Base { ${setter} ${close} }`,
    });
    const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

    expect(describeSources(methodSources(cls.getMethodOrThrow('close'), resolvedField(cls, 'status'), defaultScope(cls)))).toBe('unknown');
  });

  it('keeps parameter initializers that read the state unknown', () => {
    expect(sourceFacts(`class Order { ${status}
      set state(value = this.status) { this.status = value; }
      ${close}
    }`).sources).toBe('unknown');
  });

  it('does not take an instance cutoff from a static setter', () => {
    expect(sourceFacts(`class Order { ${status}
      static set state(value: string) {}
      get state() { return this.status; }
      ${close}
    }`).sources).toBe('unknown');
  });

  it('does not treat a nested data destination as the tracked field', () => {
    expect(analyse(`this.state = 'cancelled'; ${guard}`, 'this.nested.status = value;', "nested = { status: 'pending' };").sources).toEqual(['cancelled', 'pending']);
  });

  it('does not substitute the caller for a transformed parameter', () => {
    expect(analyse("this.state = 'cancelled';", "this.status = value === 'pending' ? 'paid' : value;").sets.unresolved).toBe(true);
  });

  it('does not prove a whole wrapper inside the setter transparent', () => {
    expect(analyse("this.state = 'cancelled';", '{ this.status = value; }').sources).toBe('unknown');
  });

  it('preserves the entry guard before an enum constant setter', () => {
    expect(sourceFacts(`enum Status { pending = 'pending', paid = 'paid', cancelled = 'cancelled' }
      class Order { status = Status.pending;
        set state(value: Status) { this.status = Status.cancelled; }
        close() { if (this.status === Status.paid) return; this.state = Status.pending; }
      }`).sets.tokens).toEqual(['cancelled']);
  });
});

describe('private setter destination overrides', () => {
  it.each([
    '@decorate class Order extends Base {}',
    'class Order extends Base { [key] = true; }',
  ])('does not prove the destination through %s', (derived) => {
    expect(sourceFacts(`class Base { ${status} ${setter.replace('state(', '#state(')} ${close.replace('this.state', 'this.#state')} } ${derived}`, 'Base').sources).toBe('unknown');
  });
});
