import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/probe12/p.ts': `
export type Status = 'open' | 'closed';
export interface Owner { status: Status }
export interface EditPolicy { canEdit(): boolean }
export class P implements EditPolicy {
  owner?: Owner;
  constructor(owner?: Owner) { this.owner = owner; }
  canEdit(): boolean { return this.owner?.status === 'open'; }
}
`,
  '/probe12/a.ts': `
import { P, Status, EditPolicy } from './p';
export class A {
  status: Status = 'open';
  private note = '';
  policy = new P(); constructor() { this.policy.owner = this; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/b.ts': `
import { P, Status, EditPolicy } from './p';
export class B {
  status: Status = 'open';
  private note = '';
  policy!: P; constructor() { this.setPolicy(new P(this)); } private setPolicy(p: P): void { this.policy = p; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/c.ts': `
import { P, Status, EditPolicy } from './p';
export class C {
  status: Status = 'open';
  private note = '';
  policy: P; constructor() { const self = this; this.policy = new P(self); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/d.ts': `
import { P, Status, EditPolicy } from './p';
export class D {
  status: Status = 'open';
  private note = '';
  policy!: P; constructor() { Object.assign(this, { policy: new P(this) }); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/e.ts': `
import { P, Status, EditPolicy } from './p';
export class E {
  status: Status = 'open';
  private note = '';
  policy!: P; constructor() { [this.policy] = [new P(this)]; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/f.ts': `
import { P, Status } from './p';
export abstract class F {
  status: Status = 'open';
  protected note = '';
  protected policy!: P;
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
export class F2 extends F { constructor() { super(); this.policy = new P(this); } }
`,
  '/probe12/g.ts': `
import { P, Status, EditPolicy } from './p';
export class G {
  status: Status = 'open';
  private note = '';
  private _p!: P; set pol(p: P) { this._p = p; } get policy(): P { return this._p; } constructor() { this.pol = new P(this); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/h.ts': `
import { P, Status } from './p';
export abstract class HBase { status: Status = 'open'; protected policy: P; constructor() { this.policy = new P(this); } }
export class H extends HBase {
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/i.ts': `
import { P, Status, EditPolicy } from './p';
export class I {
  status: Status = 'open';
  private note = '';
  policy: EditPolicy; constructor() { this.policy = new P(this); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/j.ts': `
import { P, Status, EditPolicy } from './p';
export class J {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); constructor() { this.policy = Object.assign(new P(), { owner: undefined }); this.policy.owner = this; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe12/k.ts': `
import { P, Status } from './p';
const registry = new WeakMap<object, P>();
export class K {
  status: Status = 'open';
  private note = '';
  private policy: P = new P();
  constructor() { registry.set(this.policy, this.policy); wire(this.policy, this); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
function wire(p: P, o: K): void { p.owner = o; }
`,
  '/probe13/p.ts': `
export type Status = 'open' | 'closed';
export interface Owner { status: Status }
export interface EditPolicy { canEdit(): boolean }
export class P implements EditPolicy {
  owner?: Owner;
  constructor(owner?: Owner) { this.owner = owner; }
  canEdit(): boolean { return this.owner?.status === 'open'; }
}
`,
  '/probe13/l.ts': `
import { P, Status } from './p';
export class L {
  status: Status = 'open';
  private note = '';
  private policy: P = new P();
  private checks: Array<() => boolean> = [];
  constructor() { this.policy = new P(this); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe13/m.ts': `
import { P, Status } from './p';
export class M {
  status: Status = 'open';
  private note = '';
  private policy: P;
  constructor() { this.policy = new P(this); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe13/n.ts': `
import { Status } from './p';
export class N {
  status: Status = 'open';
  private note = '';
  private rules: Array<() => boolean> = [];
  private canEdit: () => boolean = () => true;
  constructor() { this.rules.push(() => this.status === 'open'); this.canEdit = () => this.status === 'open'; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  editRules(n: string): void { if (!this.rules.every((r) => r())) return; this.note = n; }
  editFn(n: string): void { if (!this.canEdit()) return; this.note = n; }
}
`,
  '/probe13/q.ts': `
import { Status } from './p';
export class Q {
  status: Status = 'open';
  private note = '';
  private handlers!: Record<string, () => boolean>;
  private table!: Map<string, () => boolean>;
  constructor() {
    this.handlers = {};
    this.handlers['edit'] = () => this.status === 'open';
    this.table = new Map();
  }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  editRecord(n: string): void { if (!this.handlers['edit']()) return; this.note = n; }
}
`,
  '/probe14/p.ts': `
export type Status = 'open' | 'closed';
export interface Owner { status: Status }
export interface EditPolicy { canEdit(): boolean }
export class P implements EditPolicy {
  owner?: Owner;
  constructor(owner?: Owner) { this.owner = owner; }
  canEdit(): boolean { return this.owner?.status === 'open'; }
}
`,
  '/probe14/pipe.ts': `
export class Pipe { private fns: Array<() => boolean> = []; map(fn: () => boolean): this { this.fns.push(fn); return this; } run(): boolean { return this.fns.every((f) => f()); } }
`,
  '/probe14/s1.ts': `
import { P, Status } from './p';
import { Pipe } from './pipe';
export class S1 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S1 { const o = new S1(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s2.ts': `
import { P, Status } from './p';
import { Pipe } from './pipe';
export class S2 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S2 { const o = new S2(); o.policy = new P(o); return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s3.ts': `
import { P, Status } from './p';
import { Pipe } from './pipe';
export class S3 {
  status: Status = 'open';
  private note = '';
  policy = new Pipe(); constructor() { this.policy.map(() => this.status === "open"); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.run()) return; this.note = n; }
}
`,
  '/probe14/s8.ts': `
import { Status } from './p';
export class S8<T extends { canEdit(): boolean }> {
  status: Status = 'open';
  private note = '';
  constructor(private policy: T) {}
  static make(): S8<{ canEdit(): boolean; o?: S8<any> }> { const p: { canEdit(): boolean; o?: S8<any> } = { canEdit() { return p.o?.status === 'open'; } }; const a = new S8(p); p.o = a; return a; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s4.ts': `
import { P, Status } from './p';
export class S4 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S4 { const o: any = new S4(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s5.ts': `
import { P, Status } from './p';
interface Holder { policy: P }
export class S5 implements Holder {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S5 { const o: Holder = new S5(); o.policy.owner = o as S5; return o as S5; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s6.ts': `
import { P, Status } from './p';
export class S6 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S6 { const o: S6 & { x?: number } = new S6(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s7.ts': `
import { P, Status } from './p';
export class S7 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S7 { let o; o = new S7(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s9.ts': `
import { P, Status } from './p';
export class S9 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S9 { let o: any; o = new S9(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s15.ts': `
import { P, Status } from './p';
export class S15 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); constructor(seed = true) { if (seed) { const o = new S15(false); o.policy.owner = o; } }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s16.ts': `
import { P, Status } from './p';
export class S16 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); get twin(): S16 { const o = new S16(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s17.ts': `
import { P, Status } from './p';
export class S17 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); twin = (() => { const o = new S17(false); o.policy.owner = o; return o; })(); constructor(_seed = true) {}
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s10.ts': `
import { P, Status } from './p';
export class S10 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); clone(): S10 { const o = new S10(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s11.ts': `
import { P, Status } from './p';
export class S11 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); clone(): S11 { const o = new S11(); o.policy = new P(o); return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s12.ts': `
import { P, Status } from './p';
export class S12 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S12 { let o: any; o ??= new S12(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s13.ts': `
import { P, Status } from './p';
export class S13 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); static create(): S13 { let o: any; o ||= new S13(); o.policy.owner = o; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/probe14/s14.ts': `
import { P, Status } from './p';
const register = (s: S14): void => { void s; };
export class S14 {
  status: Status = 'open';
  private note = '';
  policy: P = new P(); merge(other: S14): S14 { const o = new S14(); register(other); return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { if (!this.policy.canEdit()) return; this.note = n; }
}
`,
  '/plain/name.ts': `
export type Status = 'open' | 'closed';
class Name {
  private constructor(private readonly value: string) {}
  static create(value: string): Name { return new Name(value); }
  equals(other: Name): boolean { return other.value === this.value; }
}
export class Plain {
  status: Status = 'open';
  private _name: Name;
  private tags: string[] = [];
  constructor() { this._name = Name.create('plain'); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
  retag(n: string): void { this.tags = this.tags.filter((tag) => tag !== n && this.status !== 'closed'); }
}
export class Built {
  status: Status = 'open';
  private _name!: Name;
  static create(): Built { const o = new Built(); o._name = Name.create('a'); return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class Cloned {
  status: Status = 'open';
  private _name!: Name;
  clone(): Cloned { const o = new Cloned(); o._name = this._name; return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
const compare = (other: Compared): boolean => other.status === 'open';
export class Compared {
  status: Status = 'open';
  private _name!: Name;
  same(other: Compared): boolean { return compare(other); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class AnyBuilt {
  status: Status = 'open';
  private _name!: Name;
  static create(): AnyBuilt { const o: any = new AnyBuilt(); o._name = Name.create('a'); return o; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class Listed {
  status: Status = 'open';
  id = 'a';
  private _name!: Name;
  private items: Array<{ id: string }> = [];
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  own(): number { return this.items.filter((i) => i.id === this.id).length; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class Recorder {
  status: Status = 'open';
  private note = '';
  private events: Array<{ payload: Record<string, any> }> = [];
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  annotate(n: string): void { this.note = n; this.events.push({ payload: { n } }); }
}
export class AssignedIn {
  status: Status = 'open';
  private _name!: Name;
  constructor(props: object) { Object.assign(this, props); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class AssignedAlias {
  status: Status = 'open';
  private _name!: Name;
  private owner: object;
  constructor(props: object) { const self = Object.assign(this, props); this.owner = self; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
}
export class CopiedOut {
  status: Status = 'open';
  private _name!: Name;
  protected props: { note: string } = { note: '' };
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { if (this._name.equals(Name.create(n))) return; this._name = Name.create(n); }
  snapshot(): { note: string } { return { ...this.props }; }
}
`,
});

const classNamed = (path: string, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow(path).getClassOrThrow(name);

const leaks = (target: ClassDeclaration) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [
        { target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined }], allowAfterTerminal: [] },
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

describe('aggregates that leak this', () => {
  it.each([
    ['/probe12/a.ts', 'A', 'edit'],
    ['/probe12/b.ts', 'B', 'edit'],
    ['/probe12/c.ts', 'C', 'edit'],
    ['/probe12/d.ts', 'D', 'edit'],
    ['/probe12/e.ts', 'E', 'edit'],
    ['/probe12/f.ts', 'F', 'edit'],
    ['/probe12/g.ts', 'G', 'edit'],
    ['/probe12/h.ts', 'H', 'edit'],
    ['/probe12/i.ts', 'I', 'edit'],
    ['/probe12/j.ts', 'J', 'edit'],
    ['/probe12/k.ts', 'K', 'edit'],
    ['/probe13/l.ts', 'L', 'edit'],
    ['/probe13/m.ts', 'M', 'edit'],
    ['/probe13/n.ts', 'N', 'editRules'],
    ['/probe13/n.ts', 'N', 'editFn'],
    ['/probe13/q.ts', 'Q', 'editRecord'],
    ['/probe14/s1.ts', 'S1', 'edit'],
    ['/probe14/s2.ts', 'S2', 'edit'],
    ['/probe14/s3.ts', 'S3', 'edit'],
    ['/probe14/s8.ts', 'S8', 'edit'],
    ['/probe14/s4.ts', 'S4', 'edit'],
    ['/probe14/s5.ts', 'S5', 'edit'],
    ['/probe14/s6.ts', 'S6', 'edit'],
    ['/probe14/s7.ts', 'S7', 'edit'],
    ['/probe14/s9.ts', 'S9', 'edit'],
    ['/probe14/s10.ts', 'S10', 'edit'],
    ['/probe14/s11.ts', 'S11', 'edit'],
    ['/probe14/s12.ts', 'S12', 'edit'],
    ['/probe14/s13.ts', 'S13', 'edit'],
  ])('%s %s.%s reports no leak', (path, className, method) => {
    expect(leaks(classNamed(path, className))).not.toContain(method);
  });

  it.each([
    ['a constructor', '/probe14/s15.ts', 'S15'],
    ['an accessor', '/probe14/s16.ts', 'S16'],
    ['a property initializer', '/probe14/s17.ts', 'S17'],
  ])('tracks instances built inside %s', (_, path, className) => {
    expect(leaks(classNamed(path, className))).not.toContain('edit');
  });

  it('tracks an aggregate-typed parameter of an instance member that builds an instance', () => {
    expect(leaks(classNamed('/probe14/s14.ts', 'S14'))).not.toContain('edit');
  });
});

describe('copying values into or out of the aggregate', () => {
  it('does not leak this through a discarded Object.assign into this', () => {
    expect(leaks(classNamed('/plain/name.ts', 'AssignedIn'))).toContain('rename');
  });

  it('leaks this when the result of Object.assign is kept', () => {
    expect(leaks(classNamed('/plain/name.ts', 'AssignedAlias'))).not.toContain('rename');
  });

  it('does not leak this through a spread of this.props', () => {
    expect(leaks(classNamed('/plain/name.ts', 'CopiedOut'))).toContain('rename');
  });
});

describe('aggregates that do not leak this', () => {
  it('do not leak through a static factory that only returns the built instance', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Built'))).toContain('rename');
  });

  it('do not leak through an instance factory that only copies a field into the built instance', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Cloned'))).toContain('rename');
  });

  it('do not leak through an instance method that passes a parameter of its own type to a function', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Compared'))).toContain('rename');
  });

  it('do not leak through a static factory that only returns an instance built into an any-typed local', () => {
    expect(leaks(classNamed('/plain/name.ts', 'AnyBuilt'))).toContain('rename');
  });

  it('do not leak through a this reference inside a filter callback on an array', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Listed'))).toContain('rename');
  });

  it('still report an unguarded mutator that records an event with an index-signature payload', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Recorder'))).toContain('annotate');
  });

  it('still report an unguarded mutator that reads a value-object field, even with this inside a filter callback', () => {
    expect(leaks(classNamed('/plain/name.ts', 'Plain'))).toContain('rename');
  });
});
