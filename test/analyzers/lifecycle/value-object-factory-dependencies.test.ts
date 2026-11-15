import { describe, expect, it } from 'vitest';
import { inMemoryProject } from '../../helpers/in-memory';
import { proveScalarProjection } from '../../../src/analyzers/lifecycle/value-object/projection';
import { mapProjectedValue, proveProjectedConstruction } from '../../../src/analyzers/lifecycle/value-object/assigned-value';

const source = `
enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
abstract class Base<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
}
class Status extends Base<Props> {
  constructor(value: Stage) { super({ value }); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  static fromPersistence(value: string): Status { return Status.create(value as Stage); }
}
declare const persisted: string;
declare function load(): Stage;
`;

const sample = (expression: string, text = source) => {
  const project = inMemoryProject({ '/status.ts': `${text}\nconst result = ${expression};` });
  const file = project.getSourceFileOrThrow('/status.ts');
  const cls = file.getClassOrThrow('Status');
  const proof = proveScalarProjection(cls.getType());
  if (proof.kind !== 'proven') throw new Error(proof.reason);
  return { file, cls, projection: proof.projection, expression: file.getVariableDeclarationOrThrow('result').getInitializerOrThrow() };
};

describe('projected construction dependencies', () => {
  it('proves broad persistence forwarding independently of the unresolved token', () => {
    const fixture = sample('Status.fromPersistence(persisted)');

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind).toBe('proven');
  });

  it('preserves broad persistence scalar uncertainty', () => {
    const fixture = sample('Status.fromPersistence(persisted)');

    const result = mapProjectedValue(fixture.expression, fixture.projection);

    expect(result.kind).toBe('unresolved');
  });

  it('identifies both static forwarding methods', () => {
    const fixture = sample('Status.fromPersistence(persisted)');

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind === 'proven' ? result.dependencies : []).toEqual(expect.arrayContaining([
      fixture.cls.getStaticMethodOrThrow('fromPersistence'), fixture.cls.getStaticMethodOrThrow('create'),
    ]));
  });

  it('identifies every constructor class declaration and body', () => {
    const fixture = sample('new Status(Stage.open)');
    const classes = [fixture.cls, fixture.file.getClassOrThrow('Base')];

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind === 'proven' ? result.dependencies : []).toEqual(expect.arrayContaining(classes.flatMap(cls => [
      cls, cls.getConstructors()[0], cls.getConstructors()[0]!.getBody(),
    ])));
  });

  it('keeps caller argument evaluation outside the forwarding proof', () => {
    const fixture = sample('Status.create(load())');

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind).toBe('proven');
  });

  it('does not assign a token to an effectful caller argument', () => {
    const fixture = sample('Status.create(load())');

    const result = mapProjectedValue(fixture.expression, fixture.projection);

    expect(result.kind).toBe('unresolved');
  });

  it.each(['new Status(...values)', 'Status.create(...values)'])('rejects spread arguments in %s', expression => {
    const fixture = sample(expression, `${source}\ndeclare const values: Stage[];`);

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind).toBe('unknown');
  });

  it.each([
    ['transformed argument', 'return new Status(value);', 'return new Status(value === Stage.open ? Stage.closed : Stage.open);'],
    ['side effect', 'return new Status(value);', 'load(); return new Status(value);'],
    ['default parameter', 'static create(value: Stage)', 'static create(value: Stage = Stage.open)'],
    ['rest parameter', 'static create(value: Stage)', 'static create(...value: Stage[])'],
    ['async method', 'static create(value: Stage)', 'static async create(value: Stage)'],
    ['generator method', 'static create(value: Stage)', 'static *create(value: Stage)'],
    ['recursive forwarding', 'return new Status(value);', 'return Status.create(value);'],
  ])('rejects %s', (_name, before, after) => {
    const fixture = sample('Status.create(Stage.open)', source.replace(before, after));

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind).toBe('unknown');
  });

  it('retains the finite factory depth bound', () => {
    const methods = Array.from({ length: 6 }, (_, index) => `static hop${index}(value: Stage): Status { return ${index === 5 ? 'new Status' : `Status.hop${index + 1}`}(value); }`).join('\n');
    const fixture = sample('Status.hop0(Stage.open)', source.replace('static create(value: Stage)', `${methods}\nstatic create(value: Stage)`));

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result).toEqual({ kind: 'unknown', reason: 'factory recursion bound' });
  });

  it('rejects an unrelated constructor despite the matching scalar domain', () => {
    const fixture = sample('new Other(Stage.open)', `${source}\nclass Other extends Base<Props> { constructor(value: Stage) { super({ value }); } }`);

    const result = proveProjectedConstruction(fixture.expression, fixture.projection);

    expect(result.kind).toBe('unknown');
  });
});
