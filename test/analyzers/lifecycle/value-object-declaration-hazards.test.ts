import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { inMemoryProject } from '../../helpers/in-memory';
import { SourceIndex } from '../../../src/analyzers/shared/source-index';
import { proveScalarProjection } from '../../../src/analyzers/lifecycle/value-object/projection';
import { declarationHazards } from '../../../src/analyzers/lifecycle/value-object/declaration-hazards';

const source = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
export interface StatusProps { value: Stage }
export abstract class RecordBase<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
  equals(other?: RecordBase<T>): boolean { return JSON.stringify(this.props) === JSON.stringify(other?.props); }
}
export class Status extends RecordBase<StatusProps> {
  constructor(value: Stage) { super({ value }); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  static fromPersistence(value: string): Status { return new Status(value as Stage); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
`;
const setup = (text = source, others: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({ '/status.ts': text, ...others });
  const file = project.getSourceFileOrThrow('/status.ts');
  const cls = file.getClassOrThrow('Status');
  const proof = proveScalarProjection(cls.getType());
  if (proof.kind === 'unsupported') throw new Error(proof.reason);
  return { project, file, cls, projection: proof.projection, sources: () => new SourceIndex(project.getSourceFiles()) };
};
const ownMethod = (body: string) => source.replace('  isClosed()', `  mutate(): void { ${body} }\n  isClosed()`);
const factsFor = (body: string) => {
  const fixture = setup(ownMethod(body));
  return declarationHazards(fixture.projection, fixture.sources());
};

describe('declaration scope', () => {
  it('observes no declaration hazards for the locally proven wrapper and serializer base', () => {
    const fixture = setup();

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('retains a partial scope rather than returning an admissibility certificate', () => {
    const fixture = setup();

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.scope).toBe('wrapper-declarations-only');
  });

  it('carries explicit remaining caller obligations even when no hazards are observed', () => {
    const fixture = setup();

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.remaining).toContain('use-site-receiver-and-dispatch');
  });
});

describe('observed wrapper descendants', () => {
  it.each([
    ['named', 'class Child extends Status {}'],
    ['anonymous expression', 'const Child = class extends Status {};'],
    ['named expression', 'const Child = class Named extends Status {};'],
    ['intermediate base', 'class Middle extends Status {} class Child extends Middle {}'],
    ['expression intermediate', 'const Middle = class extends Status {}; class Child extends Middle {}'],
  ])('records a %s descendant without proving equivalence', (_name, extra) => {
    const fixture = setup(`${source}\n${extra}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant')).toBe(true);
  });

  it('preserves evidence for every named intermediate descendant', () => {
    const fixture = setup(`${source}\nclass Middle extends Status {} class Child extends Middle {}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'descendant').map(hazard => hazard.node.getText())).toEqual([
      'class Middle extends Status {}', 'class Child extends Middle {}',
    ]);
  });

  it('uses imported declaration aliases to identify descendants', () => {
    const fixture = setup(source, { '/child.ts': "import { Status as Imported } from './status'; export class Child extends Imported {}" });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant' && hazard.node.getSourceFile().getFilePath() === '/child.ts')).toBe(true);
  });

  it('records unresolved heritage that refers to the real wrapper', () => {
    const fixture = setup(`${source}\nclass Child extends wrap(Status) {}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant' && hazard.relation === 'unresolved-reference')).toBe(true);
  });

  it('keeps unrelated wrappers sharing the generic base separate', () => {
    const fixture = setup(`${source}\nclass Other extends RecordBase<StatusProps> { mutate(): void { this.props.value = Stage.closed; } }`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('does not identify an unrelated same-name class by spelling', () => {
    const fixture = setup(source, {
      '/unrelated.ts': 'export class Status {}',
      '/child.ts': "import { Status } from './unrelated'; class Child extends Status {}",
    });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });
});

describe('selected storage writes', () => {
  it.each([
    'this.props.value = Stage.closed;',
    'this.props.value += Stage.closed;',
    'this.props.value++;',
    '--this.props.value;',
    'delete this.props.value;',
    '(this.props.value as Stage) = Stage.closed;',
    'this.props.value! = Stage.closed;',
    '([this.props.value] = values);',
    '({ value: this.props.value } = record);',
    'for (this.props.value of values) {}',
    'for (this.props.value in record) {}',
    'this.props = { value: Stage.closed };',
    'delete this.props;',
    "this['props']['value'] = Stage.closed;",
  ])('records direct storage mutation %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write')).toBe(true);
  });

  it('preserves the actual written target as source evidence', () => {
    const fixture = setup(ownMethod('this.props.value = Stage.closed;'));
    const target = fixture.cls.getMethodOrThrow('mutate').getFirstDescendantByKindOrThrow(SyntaxKind.PropertyAccessExpression);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write' && hazard.node === target)).toBe(true);
  });

  it('records inherited generic storage mutators even without a concrete slot symbol', () => {
    const fixture = setup(source.replace('  equals(', "  mutate(): void { (this.props as unknown as StatusProps).value = Stage.closed; }\n  equals("));

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write')).toBe(true);
  });

  it('exempts only the proven constructor storage initialization', () => {
    const fixture = setup();
    fixture.cls.getConstructors()[0]!.addStatements('this.props.value = Stage.closed;');

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write').map(hazard => hazard.node.getText())).toEqual(['this.props.value']);
  });

  it.each([
    'this.other = Stage.closed;',
    'this.props.other = Stage.closed;',
    'return this.props;',
    'opaque(this.props);',
    'JSON.stringify(this.props);',
    'Object.assign({}, this.props);',
  ])('does not treat unrelated writes or unproved operations as selected declaration writes: %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards).toEqual([]);
  });
});

describe('attributable unsupported storage mutations', () => {
  it.each([
    'this.props[key] = Stage.closed;',
    'this[key] = { value: Stage.closed };',
    'this[key].value = Stage.closed;',
    "Reflect.set(this.props, 'value', Stage.closed);",
    "Reflect.deleteProperty(this.props, 'value');",
    "Object.defineProperty(this.props, 'value', descriptor);",
    "Object.defineProperties(this.props, { value: descriptor });",
    'Object.assign(this.props, { value: Stage.closed });',
    'Object.assign(this, { props: record });',
  ])('records a bounded computed or reflective mutation fact: %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write' && hazard.reason !== 'direct-write')).toBe(true);
  });
});

describe('declaration identity and receiver boundaries', () => {
  it('finds an imported namespace alias descendant', () => {
    const fixture = setup(source, { '/child.ts': "import * as model from './status'; class Child extends model.Status {}" });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant')).toBe(true);
  });

  it('finds an anonymous default-exported descendant', () => {
    const fixture = setup(source, { '/child.ts': "import { Status } from './status'; export default class extends Status {}" });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant')).toBe(true);
  });

  it('keeps unresolved inherited wrapper references as evidence', () => {
    const fixture = setup(`${source}\nclass Middle extends wrap(Status) {} class Child extends Middle {}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'descendant').every(hazard => hazard.relation === 'unresolved-reference')).toBe(true);
  });

  it('follows a declaration-only intermediate to an observable project descendant', () => {
    const fixture = setup(source, {
      '/intermediate.d.ts': "import { Status } from './status'; export declare class Middle extends Status {}",
      '/child.ts': "import { Middle } from './intermediate'; export class Child extends Middle {}",
    });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'descendant').map(hazard => hazard.node.getSourceFile().getFilePath())).toEqual(['/child.ts']);
  });

  it('does not mistake a string spelling for a wrapper reference', () => {
    const fixture = setup(`${source}\nclass Child extends wrap('Status') {}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('does not poison the wrapper from nested unrelated class receivers', () => {
    const body = 'class Nested { props = { value: Stage.open }; mutate(): void { this.props.value = Stage.closed; } }';

    const facts = factsFor(body);

    expect(facts.hazards).toEqual([]);
  });

  it('does not bind a nested ordinary function this to the wrapper', () => {
    const facts = factsFor('function foreign(this: { props: StatusProps }): void { this.props.value = Stage.closed; }');

    expect(facts.hazards).toEqual([]);
  });

  it('observes direct lexical this writes inside an arrow body', () => {
    const facts = factsFor('const action = () => { this.props.value = Stage.closed; };');

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write')).toBe(true);
  });

  it('records a directly class-typed method parameter storage write', () => {
    const fixture = setup(source.replace('  isClosed()', '  mutate(other: Status): void { other.props.value = Stage.closed; }\n  isClosed()'));

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write')).toBe(true);
  });

  it('does not attribute a sibling-typed parameter to the selected wrapper', () => {
    const text = `${source.replace('  isClosed()', '  mutate(other: Other): void { other.props.value = Stage.closed; }\n  isClosed()')}\nclass Other extends RecordBase<StatusProps> {}`;
    const fixture = setup(text);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('does not inspect external use-site writes as declaration facts', () => {
    const fixture = setup(`${source}\nfunction mutate(other: Status): void { (other as unknown as { props: StatusProps }).props.value = Stage.closed; }`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('retains a scope limitation for cyclic heritage without inventing a descendant', () => {
    const fixture = setup(`${source}\nclass A extends B {} class B extends A {}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.limitations.some(limit => limit.reason === 'cyclic-heritage')).toBe(true);
  });
});

describe('reflective attribution boundaries', () => {
  it.each([
    'Reflect.set(this.props, key, Stage.closed);',
    'Reflect.deleteProperty(this.props, key);',
    'Object.defineProperty(this.props, key, descriptor);',
    'Object.assign(this.props, source);',
    "Reflect.set(other, 'value', Stage.closed, this.props);",
    "Object['assign'](this.props, { value: Stage.closed });",
  ])('retains attributable unsupported reflective mutation %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write' && hazard.reason === 'reflective-storage-write')).toBe(true);
  });

  it.each([
    "Reflect.set(this.props, 'other', Stage.closed);",
    'Object.assign(this.props, { other: 1 });',
    'Object.assign(this, { other: 1 });',
    'Object.defineProperties(this.props, { other: descriptor });',
    'Reflect.get(this.props, key);',
  ])('does not attribute an unrelated key or read %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards).toEqual([]);
  });

  it('does not interpret a shadowed generic Object call as built-in reflection', () => {
    const facts = factsFor("const Object = { assign(target: unknown, input: unknown) { return target; } }; Object.assign(this.props, { value: Stage.closed });");

    expect(facts.hazards).toEqual([]);
  });

  it('does not infer a reflective operation from a computed variable spelling', () => {
    const facts = factsFor("const assign = 'freeze'; Object[assign](this.props, { value: Stage.closed });");

    expect(facts.hazards).toEqual([]);
  });
});

describe('super storage semantics', () => {
  it('does not conflate a super prototype holder read with the own stored record', () => {
    const facts = factsFor("super['props'].value = Stage.closed;");

    expect(facts.hazards).toEqual([]);
  });

  it('records a whole super holder assignment that writes with the instance receiver', () => {
    const facts = factsFor("super['props'] = { value: Stage.closed };");

    expect(facts.hazards.some(hazard => hazard.kind === 'storage-write' && hazard.storage === 'holder')).toBe(true);
  });

  it('does not attribute reflection on a super prototype holder to the own record', () => {
    const facts = factsFor("Reflect.set(super['props'], 'value', Stage.closed);");

    expect(facts.hazards).toEqual([]);
  });
});

describe('bounded literal namespace heritage', () => {
  it.each(["model['Status']", 'model[`Status`]'])('finds a declaration-identity reference through %s', base => {
    const fixture = setup(source, { '/child.ts': `import * as model from './status'; class Child extends ${base} {}` });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant' && hazard.node.getSourceFile().getFilePath() === '/child.ts')).toBe(true);
  });

  it('finds an intermediate descendant through literal namespace lookup', () => {
    const fixture = setup(source, {
      '/middle.ts': "import { Status } from './status'; export class Middle extends Status {}",
      '/child.ts': "import * as model from './middle'; class Child extends model['Middle'] {}",
    });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.some(hazard => hazard.kind === 'descendant' && hazard.node.getSourceFile().getFilePath() === '/child.ts')).toBe(true);
  });

  it('does not confuse a literal lookup of an unrelated same-name class', () => {
    const fixture = setup(source, {
      '/other.ts': 'export class Status {}',
      '/child.ts': "import * as model from './other'; class Child extends model['Status'] {}",
    });

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });

  it('records reference limits rather than silently certifying an oversized lineage', () => {
    const classes = Array.from({ length: 135 }, (_, index) => `class Level${index} extends ${index === 0 ? 'Status' : `Level${index - 1}`} {}`).join('\n');
    const fixture = setup(`${source}\n${classes}`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.limitations.some(limit => limit.reason === 'heritage-bound')).toBe(true);
  });
});

describe('super deletion', () => {
  it.each(["delete super['props'];", "delete (super['props']);"])('does not confuse an always-throwing delete with own holder mutation: %s', body => {
    const facts = factsFor(body);

    expect(facts.hazards).toEqual([]);
  });
});

describe('observation scope and deduplication', () => {
  it('records each selected write once when accepted ancestry is lexically nested', () => {
    const text = `
enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
class RecordBase<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
  static define() {
    class Status extends RecordBase<Props> {
      constructor(value: Stage) { super({ value }); }
      get value(): Stage { return this.props.value; }
      mutate(): void { this.props.value = Stage.closed; }
    }
    return Status;
  }
}`;
    const project = inMemoryProject({ '/nested.ts': text });
    const cls = project.getSourceFileOrThrow('/nested.ts').getDescendantsOfKind(SyntaxKind.ClassDeclaration).find(cls => cls.getName() === 'Status');
    if (cls === undefined) throw new Error('missing nested Status');
    const proof = proveScalarProjection(cls.getType());
    if (proof.kind === 'unsupported') throw new Error(proof.reason);

    const facts = declarationHazards(proof.projection, new SourceIndex(project.getSourceFiles()));

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });

  it('does not pretend to trace a storage alias in this declaration-only task', () => {
    const facts = factsFor('const alias = this.props; alias.value = Stage.closed;');

    expect(facts.hazards).toEqual([]);
  });

  it('does not inspect project-level prototype replacement as declaration storage mutation', () => {
    const fixture = setup(`${source}\nObject.defineProperty(Status.prototype, 'value', { get() { return Stage.closed; } });`);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });
});

describe('explicit method receiver identity', () => {
  const foreign = 'class Other { props: StatusProps = { value: Stage.open }; }';
  const receiverCases = [
    ['foreign instance', 'mutate(this: Other)', 'this.props.value = Stage.closed;', foreign, 0],
    ['foreign captured this', 'mutate(this: Other)', 'const run = () => { this.props.value = Stage.closed; };', foreign, 0],
    ['foreign reflective receiver', 'mutate(this: Other)', "Reflect.set(this.props, 'value', Stage.closed);", foreign, 0],
    ['constructor receiver', 'static props: StatusProps; mutate(this: typeof Status)', 'this.props.value = Stage.closed;', '', 0],
    ['constructor captured this', 'static props: StatusProps; mutate(this: typeof Status)', 'const run = () => { this.props.value = Stage.closed; };', '', 0],
    ['unknown receiver', 'mutate(this: unknown)', '(this as Status).props.value = Stage.closed;', '', 0],
    ['any receiver', 'mutate(this: any)', 'this.props.value = Stage.closed;', '', 0],
    ['same-base sibling receiver', 'mutate(this: Other)', "this['props'].value = Stage.closed;", 'class Other extends RecordBase<StatusProps> {}', 0],
    ['implicit instance', 'mutate()', 'this.props.value = Stage.closed;', '', 1],
    ['implicit captured this', 'mutate()', 'const run = () => { this.props.value = Stage.closed; };', '', 1],
    ['exact wrapper receiver', 'mutate(this: Status)', 'this.props.value = Stage.closed;', '', 1],
    ['exact wrapper captured this', 'mutate(this: Status)', 'const run = () => { this.props.value = Stage.closed; };', '', 1],
    ['polymorphic receiver', 'mutate(this: this)', 'this.props.value = Stage.closed;', '', 1],
    ['polymorphic captured this', 'mutate(this: this)', 'const run = () => { this.props.value = Stage.closed; };', '', 1],
    ['accepted base instance receiver', 'mutate(this: RecordBase<StatusProps>)', "this['props'].value = Stage.closed;", '', 1],
    ['implicit static receiver', 'static props: StatusProps; static mutate()', 'this.props.value = Stage.closed;', '', 0],
  ] as const;
  const receiverFixture = (signature: string, body: string, extra: string) => setup(
    `${source.replace('  isClosed()', `  ${signature}: void { ${body} }\n  isClosed()`)}\n${extra}`,
  );

  it.each(receiverCases)('uses zero-diagnostic %s source', (_name, signature, body, extra) => {
    const fixture = receiverFixture(signature, body, extra);

    const diagnostics = fixture.project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText());

    expect(diagnostics).toEqual([]);
  });

  it.each(receiverCases)('attributes %s storage observations to the actual receiver', (_name, signature, body, extra, expected) => {
    const fixture = receiverFixture(signature, body, extra);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(expected);
  });

  it('retains inherited explicit generic instance-this writes', () => {
    const fixture = setup(source.replace('  equals(', '  mutate(this: RecordBase<T>): void { (this.props as unknown as StatusProps).value = Stage.closed; }\n  equals('));

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });

  it('retains inherited polymorphic instance-this writes', () => {
    const fixture = setup(source.replace('  equals(', '  mutate(this: this): void { (this.props as unknown as StatusProps).value = Stage.closed; }\n  equals('));

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });

  it('does not bind an inherited explicit foreign receiver to the wrapper', () => {
    const text = `${source.replace('  equals(', '  mutate(this: Other): void { this.props.value = Stage.closed; }\n  equals(')}\n${foreign}`;
    const fixture = setup(text);

    const facts = declarationHazards(fixture.projection, fixture.sources());

    expect(facts.hazards).toEqual([]);
  });
});

describe('reflective observation multiplicity', () => {
  it('deduplicates the same selected target and explicit receiver observation', () => {
    const facts = factsFor("Reflect.set(this.props, 'value', Stage.closed, this.props);");

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });

  it('retains the conservative selected-target observation with an unproved explicit receiver', () => {
    const facts = factsFor("Reflect.set(this.props, 'value', Stage.closed, {});");

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });

  it('retains a selected explicit receiver when the target is unproved', () => {
    const facts = factsFor("Reflect.set({}, 'value', Stage.closed, this.props);");

    expect(facts.hazards.filter(hazard => hazard.kind === 'storage-write')).toHaveLength(1);
  });
});
