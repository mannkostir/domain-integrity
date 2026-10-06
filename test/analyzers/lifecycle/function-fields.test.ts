import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/lib.d.ts': `
export declare abstract class Base {
  readonly id: string;
}
`,
  '/src/item.ts': `
import { Base } from '../types/lib';
export type Status = 'open' | 'closed';
type Policy = { canEdit: () => boolean };
class EditPolicy {
  constructor(private readonly target: { readonly state: string }) {}
  canEdit(): boolean { return this.target.state === 'open'; }
}
class Name {
  private constructor(private readonly value: string) {}
  static create(value: string): Name { return new Name(value); }
  equals(other: Name): boolean { return other.value === this.value; }
  text(): string { return this.value; }
}
class Checks {
  private readonly checks = new Set<() => boolean>();
  register(check: () => boolean): void { this.checks.add(check); }
  check(): boolean { return [...this.checks].every((c) => c()); }
}
export class Item extends Base {
  private status: Status = 'open';
  private note = '';
  private canEdit!: () => boolean;
  private policy!: Policy;
  private rules!: Array<() => boolean>;
  private touchedAt!: Date;
  private guard: EditPolicy;
  private initialGuard = new EditPolicy(this);
  private _name: Name;
  private builtGuard: EditPolicy;
  private policies: EditPolicy[];
  private tags: string[];
  private config: Checks;
  private settings: object;
  get state(): string { return this.status; }
  constructor() {
    super();
    this.canEdit = () => this.status === 'open';
    this.policy = { canEdit: () => this.status === 'open' };
    this.rules = [() => this.status === 'open'];
    this.guard = new EditPolicy(this);
    this._name = Name.create('item');
    this.builtGuard = this.buildGuard();
    this.policies = [];
    this.policies.push(new EditPolicy(this));
    this.tags = [];
    this.config = new Checks();
    this.config.register(() => this.status !== 'closed');
    this.settings = {};
    Object.assign(this.settings, { check: () => this.status === 'open' });
  }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  aliasFn(n: string): void { const f = this.canEdit; if (!f()) return; this.note = n; }
  viaPolicy(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
  viaRules(n: string): void { if (!this.rules.every((r) => r())) return; this.note = n; }
  renameById(n: string): void { this.note = n + this.id; }
  append(n: string): void { this.note = this.note + n; }
  touch(n: string): void { this.touchedAt = new Date(); this.note = n; }
  viaGuard(n: string): void { if (!this.guard.canEdit()) return; this.note = n; }
  viaInitialGuard(n: string): void { if (!this.initialGuard.canEdit()) return; this.note = n; }
  private buildGuard(): EditPolicy { return new EditPolicy(this); }
  viaBuiltGuard(n: string): void { if (!this.builtGuard.canEdit()) return; this.note = n; }
  extend(n: string): void { this._name = Name.create(this._name.text() + n); }
  viaPolicies(n: string): void { if (!this.policies.every((p) => p.canEdit())) return; this.note = n; }
  viaConfig(n: string): void { if (!this.config.check()) return; this.note = n; }
  viaSettings(n: string): void { if (!(this.settings as { check: () => boolean }).check()) return; this.note = n; }
  tag(n: string): void { this.tags.push(n); this.note = n; }
  stamp(n: string): void { this.note = n + this.touchedAt.toISOString(); }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); this.note = n; }
}
`,
});

const item = project.getSourceFileOrThrow('/src/item.ts').getClassOrThrow('Item');

const sourcesOf = (methodName: string) =>
  describeSources(methodSources(item.getMethodOrThrow(methodName), resolvedField(item, 'status'), defaultScope(item)));

const leaks = () => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [
        { target: item, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] },
      ],
    },
    files: project.getSourceFiles(),
    root: '/',
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method);
};

describe('fields holding functions', () => {
  it('report no leak when a function field is read through a local', () => {
    expect(leaks()).not.toContain('aliasFn');
  });

  it('report no leak when an object field holds a method', () => {
    expect(leaks()).not.toContain('viaPolicy');
  });

  it('report no leak when an array field holds closures', () => {
    expect(leaks()).not.toContain('viaRules');
  });
});

describe('object fields of an aggregate that leaks this', () => {
  it('read the field when the constructor passes this to their value', () => {
    expect(sourcesOf('viaGuard')).toBe('unknown');
  });

  it('read the field when their initializer passes this to their value', () => {
    expect(sourcesOf('viaInitialGuard')).toBe('unknown');
  });

  it('read the field when their value comes from a method of the aggregate', () => {
    expect(sourcesOf('viaBuiltGuard')).toBe('unknown');
  });

  it('read the field when a collection mutator adds a value holding this', () => {
    expect(sourcesOf('viaPolicies')).toBe('unknown');
  });

  it('read the field when a method on its value receives a closure over this', () => {
    expect(sourcesOf('viaConfig')).toBe('unknown');
  });

  it('read the field when it is passed to a call alongside a closure over this', () => {
    expect(sourcesOf('viaSettings')).toBe('unknown');
  });
});

describe('primitive fields of an aggregate that leaks this', () => {
  it('leave a mutator pushing plain values into a collection judged', () => {
    expect(leaks()).toContain('tag');
  });

  it('leave a mutator reading a Date field judged', () => {
    expect(leaks()).toContain('stamp');
  });

  it('leave a mutator reading a library string property judged', () => {
    expect(leaks()).toContain('renameById');
  });

  it('leave a mutator reading a project string field judged', () => {
    expect(leaks()).toContain('append');
  });

  it('leave a mutator that only overwrites a field holding methods judged', () => {
    expect(leaks()).toContain('touch');
  });
});
