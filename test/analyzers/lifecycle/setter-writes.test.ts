import { describe, expect, it } from 'vitest';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const sourcesOf = (members: string, statement = "this.label = 'x';", base = '', guard = "if (this.status === 'cancelled') return;") => {
  const project = inMemoryProject({
    '/src/order.ts': `
${base}
class Order ${base === '' ? '' : 'extends Base'} {
  status: 'pending' | 'paid' | 'cancelled' = 'pending';
  title = '';
  ${members}
  rename(): void {
    ${guard}
    ${statement}
  }
}
`,
  });
  const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');
  return describeSources(methodSources(cls.getMethodOrThrow('rename'), resolvedField(cls, 'status'), defaultScope(cls)));
};

const accessors = `
get label(): string { return this.status; }
set label(value: string) { this.title = value; }
`;

describe('plain writes through setters', () => {
  it('preserves the guard when the setter only writes an unrelated field', () => {
    expect(sourcesOf(accessors)).toEqual(['paid', 'pending']);
  });
});

describe('setter write boundaries', () => {
  it.each([
    "this.label += 'x';",
    "this.label ||= 'x';",
    "this.label ??= 'x';",
    "this.label &&= 'x';",
  ])('still reads the getter for %s', (statement) => {
    expect(sourcesOf(accessors, statement)).toBe('unknown');
  });

  it.each(['this.label++;', '--this.label;'])('still reads a numeric getter for %s', (statement) => {
    expect(sourcesOf(`
      count = 0;
      get label(): number { return this.status.length; }
      set label(value: number) { this.count = value; }
    `, statement)).toBe('unknown');
  });

  it('traces an inherited setter without reading its getter', () => {
    expect(sourcesOf('', "this.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${accessors}
    }`)).toEqual(['paid', 'pending']);
  });

  it('traces a setter without a getter', () => {
    expect(sourcesOf('set label(value: string) { this.title = value; }')).toEqual(['paid', 'pending']);
  });

  it('supports element access without relying on the member name', () => {
    expect(sourcesOf(accessors.replaceAll('label', 'caption'), "(this['caption']) = 'x';")).toEqual(['paid', 'pending']);
  });

  it.each([
    'this.title = this.status;',
    "if (this.status === 'pending') this.title = value;",
    'this.assertOpen();',
    'this.missing(value);',
    'this.label = value;',
    'consume(this);',
    'this[key] = value;',
  ])('keeps sources unknown when the setter does %s', (body) => {
    expect(sourcesOf(`get label(): string { return this.status; }
      set label(value: string) { ${body} }
      assertOpen(): void { if (this.status === 'cancelled') throw new Error('closed'); }
    `)).toBe('unknown');
  });

  it('keeps a setter with no implementation unknown', () => {
    expect(sourcesOf('declare set label(value: string);')).toBe('unknown');
  });

  it('keeps a getter-only write unknown', () => {
    expect(sourcesOf('get label(): string { return this.status; }')).toBe('unknown');
  });

  it('does not bypass a getter that shadows a base setter', () => {
    expect(sourcesOf('get label(): string { return this.status; }', "this.label = 'x';", `class Base {
      title = '';
      set label(value: string) { this.title = value; }
    }`)).toBe('unknown');
  });

  it('does not treat duplicate setter declarations as resolved', () => {
    expect(sourcesOf(`${accessors} set label(value: string) { this.title = value; }`)).toBe('unknown');
  });

  it('still traces the right hand side of a plain write', () => {
    expect(sourcesOf(accessors, 'this.label = this.status;')).toBe('unknown');
  });

  it('does not treat an unrelated setter as overwriting the state field', () => {
    expect(sourcesOf(accessors, "this.label = 'x'; this.title = this.status;")).toBe('unknown');
  });

  it('preserves guards after an unrelated setter write', () => {
    expect(sourcesOf(accessors, "this.label = 'x'; if (this.status === 'paid') return; this.title = 'y';")).toEqual(['pending']);
  });

  it('judges an unguarded plain write from every state', () => {
    expect(sourcesOf(accessors, "this.label = 'x';", '', '')).toEqual(['cancelled', 'paid', 'pending']);
  });
});

describe('bounded setter tracing', () => {
  it('follows an unrelated helper called by the setter', () => {
    expect(sourcesOf(`
      get label(): string { return this.status; }
      set label(value: string) { this.store(value); }
      store(value: string): void { this.title = value; }
    `)).toEqual(['paid', 'pending']);
  });

  it('keeps a parameter initializer that reads the state unknown', () => {
    expect(sourcesOf(`
      get label(): string { return this.status; }
      set label(value: string = this.status) { this.title = value; }
    `)).toBe('unknown');
  });

  it('keeps a setter beyond the tracing bound unknown', () => {
    expect(sourcesOf(`
      ${accessors.replace('this.title = value;', 'this.a = value;')}
      set a(value: string) { this.b = value; }
      set b(value: string) { this.c = value; }
      set c(value: string) { this.d = value; }
      set d(value: string) { this.e = value; }
      set e(value: string) { this.f = value; }
      set f(value: string) { this.title = value; }
    `)).toBe('unknown');
  });

  it('preserves a direct data overwrite despite a state-reading initializer', () => {
    expect(sourcesOf('label = this.status;')).toEqual(['paid', 'pending']);
  });

  it('does not ignore the getter for a compound inherited accessor write', () => {
    expect(sourcesOf('', "this.label += 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${accessors}
    }`)).toBe('unknown');
  });

  it('resolves an explicit super setter from its declaring base', () => {
    expect(sourcesOf('get label(): string { return this.status; }', "super.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${accessors}
    }`)).toEqual(['paid', 'pending']);
  });
});

describe('ambiguous setter implementations', () => {
  it('keeps a computed declaration that may replace the setter unknown', () => {
    expect(sourcesOf(`${accessors} set [key](value: string) { this.title = value; }`)).toBe('unknown');
  });

  it('keeps a decorated setter unknown', () => {
    expect(sourcesOf(accessors.replace('set label', '@decorate set label'))).toBe('unknown');
  });

  it('keeps a setter on a decorated base unknown', () => {
    expect(sourcesOf('', "this.label = 'x';", `@decorate class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${accessors}
    }`)).toBe('unknown');
  });
});

describe('static and instance setters with the same name', () => {
  it('does not use a static setter to prove an instance write harmless', () => {
    expect(sourcesOf(`
      static set label(value: string) {}
      get label(): string { return this.status; }
      set label(value: string) { if (this.status === 'paid') return; this.status = 'paid'; }
    `)).toBe('unknown');
  });
});

describe('exact instance setter resolution', () => {
  it.each([
    ['own', ''],
    ['inherited', 'base'],
  ])('judges an inert %s instance setter despite an earlier static setter', (_kind, inherited) => {
    const members = `static set label(value: string) {} ${accessors}`;
    const base = inherited === '' ? '' : `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${members}
    }`;

    expect(sourcesOf(inherited === '' ? members : '', "this.label = 'x';", base)).toEqual(['paid', 'pending']);
  });

  it.each(['', 'inherited'])('keeps guarded instance setters unknown with %s static collisions', (inherited) => {
    const members = `static set label(value: string) {}
      get label(): string { return this.status; }
      set label(value: string) {
        if (this.status === 'cancelled') throw new Error('closed');
        this.title = value;
      }`;
    const base = inherited === '' ? '' : `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${members}
    }`;

    expect(sourcesOf(inherited === '' ? members : '', "this.label = 'x';", base, '')).toBe('unknown');
  });

  it('ignores a static setter on the derived class when resolving the inherited instance setter', () => {
    expect(sourcesOf('static set label(value: string) {}', "this.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      ${accessors}
    }`)).toEqual(['paid', 'pending']);
  });

  it('traces the guarded inherited instance setter despite a derived static setter', () => {
    expect(sourcesOf('static set label(value: string) {}', "this.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      get label(): string { return this.status; }
      set label(value: string) { if (this.status === 'cancelled') return; this.title = value; }
    }`, '')).toBe('unknown');
  });

  it('still reads the getter for a compound write with a static collision', () => {
    expect(sourcesOf(`static set label(value: string) {} ${accessors}`, "this.label += 'x';")).toBe('unknown');
  });

  it('still reads the numeric getter for an update with a static collision', () => {
    expect(sourcesOf(`
      count = 0;
      static set label(value: number) {}
      get label(): number { return this.status.length; }
      set label(value: number) { this.count = value; }
    `, 'this.label++;')).toBe('unknown');
  });
});

describe('conservative tracing of shadowed setters', () => {
  it('retains unknown when a constant getter shadows a guarded base setter', () => {
    expect(sourcesOf("get label(): string { return 'label'; }", "this.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      get label(): string { return this.status; }
      set label(value: string) { if (this.status === 'cancelled') return; this.title = value; }
    }`, '')).toBe('unknown');
  });

  it('retains unknown when a property shadows a state-writing base setter', () => {
    expect(sourcesOf("label = '';", "this.label = 'x';", `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      set label(value: string) { this.status = 'paid'; }
    }`, '')).toBe('unknown');
  });
});

describe('state-writing inherited setters with static collisions', () => {
  it.each(['base', 'derived'])('retains unknown with the static setter on the %s class', (owner) => {
    const staticSetter = 'static set label(value: string) {}';
    const base = `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      ${owner === 'base' ? staticSetter : ''}
      get label(): string { return this.status; }
      set label(value: string) { this.status = 'paid'; }
    }`;

    expect(sourcesOf(owner === 'derived' ? staticSetter : '', "this.label = 'x';", base)).toBe('unknown');
  });
});

describe('exact instance getters after setter writes', () => {
  const guardedAccessors = `
    count = 0;
    static status: 'pending' | 'paid' | 'cancelled' = 'pending';
    static get label(): number { return 0; }
    static set label(value: number) { this.status = 'paid'; }
    get label(): number {
      if (this.status === 'cancelled') throw new Error('closed');
      return this.count;
    }
    set label(value: number) { this.count = value; }
  `;

  it.each([
    ['own', 'this.label += 1;'],
    ['own', 'this.label++;'],
    ['own', '--this.label;'],
    ['inherited', 'this.label += 1;'],
    ['inherited', 'this.label++;'],
    ['inherited', '--this.label;'],
  ])('traces the guarded %s instance getter for %s', (owner, statement) => {
    const base = owner === 'own' ? '' : `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      ${guardedAccessors}
    }`;

    expect(sourcesOf(owner === 'own' ? guardedAccessors : '', statement, base, '')).toBe('unknown');
  });

  it('skips a derived static getter to trace the inherited instance getter', () => {
    expect(sourcesOf('static get label(): number { return 0; }', 'this.label++;', `class Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      ${guardedAccessors}
    }`, '')).toBe('unknown');
  });

  it('still bypasses a guarded instance getter for a plain write', () => {
    expect(sourcesOf(guardedAccessors, 'this.label = 1;')).toEqual(['paid', 'pending']);
  });

  it('does not read a state-reading static getter instead of an inert instance getter', () => {
    expect(sourcesOf(`
      count = 0;
      static status: 'pending' | 'paid' | 'cancelled' = 'pending';
      static get label(): number { return this.status.length; }
      get label(): number { return this.count; }
      set label(value: number) { this.count = value; }
    `, 'this.label++;')).toEqual(['paid', 'pending']);
  });
});
