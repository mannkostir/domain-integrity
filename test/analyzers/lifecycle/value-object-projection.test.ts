import { describe, expect, it } from 'vitest';
import { ScriptTarget } from 'ts-morph';
import { inMemoryProject } from '../../helpers/in-memory';
import { proveScalarProjection } from '../../../src/analyzers/lifecycle/value-object/projection';
import { mapProjectedValue } from '../../../src/analyzers/lifecycle/value-object/assigned-value';

const source = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface StatusProps { value: Stage }
abstract class RecordBase<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
}
export class Status extends RecordBase<StatusProps> {
  constructor(value: Stage) {
    if (!Object.values(Stage).includes(value)) throw new Error(\`Invalid status: \${value}\`);
    super({ value });
  }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  static fromPersistence(value: string): Status { return new Status(value as Stage); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
`;

const sample = (text = source, expression = 'Status.create(Stage.closed)') => {
  const project = inMemoryProject({ '/status.ts': `${text}\nconst result = ${expression};` });
  const file = project.getSourceFileOrThrow('/status.ts');
  const cls = file.getClassOrThrow('Status');
  return { project, file, cls, expression: file.getVariableDeclarationOrThrow('result').getInitializerOrThrow() };
};

const mapping = (text = source, expression = 'Status.create(Stage.closed)') => {
  const fixture = sample(text, expression);
  const proof = proveScalarProjection(fixture.cls.getType());
  if (proof.kind === 'unsupported') throw new Error(proof.reason);
  return mapProjectedValue(fixture.expression, proof.projection);
};

describe('scalar projection proof', () => {
  it('proves the inherited generic record and finite enum getter', () => {
    const { cls } = sample();

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind === 'proven' ? proof.projection.values.map(value => value.token) : proof).toEqual(['OPEN', 'CLOSED']);
  });

  it('preserves the scalar storage symbol rather than relying on its spelling', () => {
    const { cls, file } = sample();

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind === 'proven' ? proof.projection.storage.slot : proof).toBe(
      file.getInterfaceOrThrow('StatusProps').getPropertyOrThrow('value').getSymbol(),
    );
  });

  it('uses the concrete wrapper type to substitute the generic record', () => {
    const { cls } = sample();

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind === 'proven' ? proof.projection.enumDeclaration.getName() : proof).toBe('Stage');
  });

  it('does not claim that local construction proves observable immutability', () => {
    const { cls } = sample();

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind === 'proven' ? proof.projection.scope : proof).toBe('local-construction-and-getter');
  });
});

describe('projected assigned values', () => {
  it('maps the exact static factory argument to a scalar token', () => {
    const result = mapping();

    expect(result).toEqual({ kind: 'known', token: 'CLOSED' });
  });

  it('maps direct construction to a scalar token', () => {
    const result = mapping(source, 'new Status(Stage.open)');

    expect(result).toEqual({ kind: 'known', token: 'OPEN' });
  });

  it('keeps a broad persistence string unresolved through its assertion', () => {
    const text = `${source}\ndeclare const persisted: string;`;

    const result = mapping(text, 'Status.fromPersistence(persisted)');

    expect(result.kind).toBe('unresolved');
  });

  it('keeps a broad enum argument unresolved', () => {
    const text = `${source}\ndeclare const stage: Stage;`;

    const result = mapping(text, 'Status.create(stage)');

    expect(result.kind).toBe('unresolved');
  });

  it('resolves a literal persistence value without trusting the cast', () => {
    const result = mapping(source, "Status.fromPersistence('OPEN')");

    expect(result).toEqual({ kind: 'known', token: 'OPEN' });
  });

  it('rejects a construction of a different class with the same scalar shape', () => {
    const text = `${source}\nclass Other extends RecordBase<StatusProps> { constructor(value: Stage) { super({ value }); } }`;

    const result = mapping(text, 'new Other(Stage.open)');

    expect(result.kind).toBe('unresolved');
  });
});


describe('unsupported projection shapes', () => {
  it.each([
    ['transformed scalar', source.replace('super({ value });', 'super({ value: transform(value) });')],
    ['wrong parameter', source.replace('constructor(value: Stage)', 'constructor(value: Stage, other: Stage)').replace('super({ value });', 'super({ value: other });')],
    ['constant instead of parameter', source.replace('super({ value });', 'super({ value: Stage.open });')],
    ['extra write', source.replace('super({ value });', 'super({ value }); this.props.value = Stage.open;')],
    ['unknown call', source.replace('super({ value });', 'super({ value }); unknownCall();')],
    ['wrapper leak', source.replace('super({ value });', 'super({ value }); retain(this);')],
    ['base record leak', source.replace('this.props = props;', 'this.props = props; retain(props);')],
    ['caller record', source.replace('constructor(value: Stage)', 'constructor(value: StatusProps)').replace('super({ value });', 'super(value);')],
    ['record spread', source.replace('super({ value });', 'super({ ...{ value } });')],
    ['effectful record property', source.replace('super({ value });', 'super({ value, extra: unknownCall() });')],
    ['effectful getter', source.replace('return this.props.value;', 'unknownCall(); return this.props.value;')],
    ['computed getter result', source.replace('return this.props.value;', 'return transform(this.props.value);')],
    ['different receiver', `declare const other: Status;\n${source.replace('return this.props.value;', 'return other.props.value;')}`],
    ['ambiguous getter', source.replace('  isClosed()', '  get code(): Stage { return this.props.value; }\n  isClosed()')],
    ['getter override', source.replace('protected readonly props: T;', 'protected readonly props: T; get value(): Stage { return Stage.open; }')],
    ['getter setter pair', source.replace('  isClosed()', '  set value(value: Stage) { this.props.value = value; }\n  isClosed()')],
    ['record accessor', source.replace('protected readonly props: T;', 'protected get props(): T { return external; }')],
    ['record slot accessor', source.replace('interface StatusProps { value: Stage }', 'class StatusProps { get value(): Stage { return Stage.open; } }')],
    ['instance initializer', source.replace('  isClosed()', '  private label = unknownCall();\n  isClosed()')],
    ['default parameter', source.replace('constructor(value: Stage)', 'constructor(value: Stage = Stage.open)')],
    ['unknown validation', source.replace('!Object.values(Stage).includes(value)', '!validate(value)')],
    ['effectful error payload', source.replace('new Error(`Invalid status: ${value}`)', 'new Error(unknownCall(value))')],
    ['validation else', source.replace('throw new Error(`Invalid status: ${value}`);', 'throw new Error(`Invalid status: ${value}`); else unknownCall();')],
    ['shadowed Object', `const Object = { values: (value: unknown) => [] as Stage[] };\n${source}`],
    ['shadowed Error', `class Error { constructor(message: string) { retain(message); } }\n${source}`],
    ['non enum scalar', source.replace("export enum Stage { open = 'OPEN', closed = 'CLOSED' }", "type Stage = 'OPEN' | 'CLOSED'; const Stage = { open: 'OPEN', closed: 'CLOSED' } as const;")],
  ])('does not prove %s', (_name, text) => {
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('accepts an equally proven record and getter with different names', () => {
    const { cls } = sample(source.replaceAll('props', 'record').replace(/\bvalue\b/g, 'code'));

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('proven');
  });

  it('rejects unresolved inheritance', () => {
    const { cls } = sample(source.replace('extends RecordBase<StatusProps>', 'extends MissingBase<StatusProps>'));

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('rejects cyclic inheritance without recursing forever', () => {
    const { cls } = sample(source.replace('abstract class RecordBase<T> {', 'abstract class RecordBase<T> extends Status {'));

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('withholds a projection beyond the constructor chain bound', () => {
    const bases = Array.from({ length: 6 }, (_, index) => `class Layer${index}<T> extends ${index === 0 ? 'RecordBase' : `Layer${index - 1}`}<T> { constructor(props: T) { super(props); } }`).join('\n');
    const text = source.replace('export class Status extends RecordBase', `${bases}\nexport class Status extends Layer5`);
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('proves a bounded intermediate generic constructor forwarding the fresh record', () => {
    const text = source.replace('export class Status extends RecordBase', 'class Intermediate<T> extends RecordBase<T> { constructor(props: T) { super(props); } }\nexport class Status extends Intermediate');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('proven');
  });

  it('rejects a declaration-only base even with the expected data member', () => {
    const fixture = sample(source.replace('abstract class RecordBase<T> {\n  protected readonly props: T;\n  constructor(props: T) { this.props = props; }\n}', "import { RecordBase } from './record-base';"));
    fixture.project.createSourceFile('/record-base.d.ts', 'export declare abstract class RecordBase<T> { protected readonly props: T; constructor(props: T); }');
    fixture.project.resolveSourceFileDependencies();

    const proof = proveScalarProjection(fixture.cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('rejects a declaration-only wrapper', () => {
    const fixture = sample();
    const file = fixture.project.createSourceFile('/external.d.ts', 'export declare class External { get value(): Stage; }');

    const proof = proveScalarProjection(file.getClassOrThrow('External').getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('rejects a structural object with an enum value property', () => {
    const { file } = sample(`${source}\ndeclare const lookalike: { value: Stage };`);

    const proof = proveScalarProjection(file.getVariableDeclarationOrThrow('lookalike').getType());

    expect(proof.kind).toBe('unsupported');
  });
});

describe('unresolved construction and factory values', () => {
  it.each([
    ['transformed input', source.replace('return new Status(value);', 'return new Status(transform(value));')],
    ['constant input', source.replace('return new Status(value);', 'return new Status(Stage.open);')],
    ['extra statements', source.replace('return new Status(value);', 'unknownCall(); return new Status(value);')],
    ['alternate return', source.replace('return new Status(value);', 'if (flag) return new Status(value); return new Status(value);')],
    ['parameter default', source.replace('static create(value: Stage)', 'static create(value: Stage = Stage.open)')],
    ['async factory', source.replace('static create(value: Stage): Status', 'static async create(value: Stage): Promise<Status>')],
    ['recursive factory', source.replace('return new Status(value);', 'return Status.create(value);')],
    ['abstract factory', source.replace('static create(value: Stage): Status { return new Status(value); }', 'static create(value: Stage): Status;')],
  ])('withholds %s', (_name, text) => {
    const result = mapping(text);

    expect(result.kind).toBe('unresolved');
  });

  it.each([
    'Status.create(unknownCall())',
    'Status.create(external.value)',
    'Status.create(...values)',
    'Status.create(Stage.open, Stage.closed)',
    'Status.create()',
    'new Status()',
    'new Status(...values)',
    'new Status(Stage.open, Stage.closed)',
    'Status.create?.(Stage.open)',
    'Status?.create(Stage.open)',
    "Status.fromPersistence('INVALID')",
    'Status.fromPersistence(persisted as Stage)',
  ])('withholds unproved expression %s', expression => {
    const result = mapping(`${source}\ndeclare const persisted: string;`, expression);

    expect(result.kind).toBe('unresolved');
  });

  it('uses parameter identity through a bounded pure forwarding factory', () => {
    const text = source.replace('  isClosed()', '  static wrap(input: Stage): Status { return Status.create(input); }\n  isClosed()');

    const result = mapping(text, 'Status.wrap(Stage.open)');

    expect(result).toEqual({ kind: 'known', token: 'OPEN' });
  });

  it('does not infer factory purity from an instance receiver type', () => {
    const text = `${source}\ndeclare const receiver: typeof Status;`;

    const result = mapping(text, 'receiver.create(Stage.open)');

    expect(result.kind).toBe('unresolved');
  });

  it('does not conflate a foreign enum member with the same scalar spelling', () => {
    const text = `${source}\nenum OtherStage { open = 'OPEN' }`;

    const result = mapping(text, 'new Status(OtherStage.open)');

    expect(result.kind).toBe('unresolved');
  });

  it('does not trust a literal return type to prove argument purity', () => {
    const text = `${source}\ndeclare function effect(): Stage.open;`;

    const result = mapping(text, 'new Status(effect())');

    expect(result.kind).toBe('unresolved');
  });

  it('does not accept a factory body that forwards an identically named foreign variable', () => {
    const text = source.replace('return new Status(value);', "return new Status((() => { const value = Stage.open; return value; })());");

    const result = mapping(text);

    expect(result.kind).toBe('unresolved');
  });

  it('withholds forwarding beyond the factory recursion bound', () => {
    const methods = Array.from({ length: 7 }, (_, index) => `static forward${index}(value: Stage): Status { return Status.${index === 6 ? 'create' : `forward${index + 1}`}(value); }`).join('\n');
    const text = source.replace('  isClosed()', `${methods}\n  isClosed()`);

    const result = mapping(text, 'Status.forward0(Stage.open)');

    expect(result.kind).toBe('unresolved');
  });

  it('rejects indirect factory cycles within the recursion bound', () => {
    const text = source.replace('return new Status(value);', 'return Status.again(value);').replace('  isClosed()', 'static again(value: Stage): Status { return Status.create(value); }\n  isClosed()');

    const result = mapping(text);

    expect(result.kind).toBe('unresolved');
  });

  it('retains the concrete wrapper declaration across an import alias', () => {
    const fixture = sample();
    const file = fixture.project.createSourceFile('/consumer.ts', "import { Status as LocalStatus, Stage } from './status'; const assigned = LocalStatus.create(Stage.open);");
    const proof = proveScalarProjection(fixture.cls.getType());
    if (proof.kind === 'unsupported') throw new Error(proof.reason);

    const result = mapProjectedValue(file.getVariableDeclarationOrThrow('assigned').getInitializerOrThrow(), proof.projection);

    expect(result).toEqual({ kind: 'known', token: 'OPEN' });
  });

  it('does not accept a mismatched class factory with an otherwise matching body', () => {
    const text = `${source}\nclass Other { static create(value: Stage): Status { return new Status(value); } }`;

    const result = mapping(text, 'Other.create(Stage.open)');

    expect(result.kind).toBe('unresolved');
  });
});

describe('class definition and constructor effects', () => {
  it.each([
    ['static initializer', source.replace('  isClosed()', '  static setup = unknownCall();\n  isClosed()')],
    ['static block', source.replace('  isClosed()', '  static { unknownCall(); }\n  isClosed()')],
    ['computed member', source.replace('  isClosed()', '  [unknownCall()](): void {}\n  isClosed()')],
    ['class decorator', source.replace('export class Status', '@decorate\nexport class Status')],
    ['static method decorator', source.replace('  static create', '  @decorate\n  static create')],
    ['storage decorator', source.replace('  protected readonly props', '  @decorate\n  protected readonly props')],
    ['constructor parameter decorator', source.replace('constructor(value: Stage)', 'constructor(@decorate value: Stage)')],
    ['constructor overloads', source.replace('  constructor(value: Stage) {', '  constructor(value: Stage);\n  constructor(value: Stage) {')],
  ])('withholds %s', (_name, text) => {
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('proves a fresh constructor with no validation effects', () => {
    const text = source.replace('    if (!Object.values(Stage).includes(value)) throw new Error(`Invalid status: ${value}`);\n', '');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('proven');
  });

  it('keeps local proof obligations explicit for subsequent project analysis', () => {
    const { cls } = sample();

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind === 'proven' ? proof.projection.requires : proof).toEqual([
      'observable-mutation-and-escape-analysis', 'dispatch-invalidation',
    ]);
  });

  it('accepts enum validation with a block containing only the rejection', () => {
    const text = source.replace('throw new Error(`Invalid status: ${value}`);', '{ throw new Error(`Invalid status: ${value}`); }');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('proven');
  });

  it('rejects extra work in the validation rejection branch', () => {
    const text = source.replace('throw new Error(`Invalid status: ${value}`);', '{ unknownCall(); throw new Error(`Invalid status: ${value}`); }');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('maps numeric enum literals without changing their scalar representation', () => {
    const text = source.replace("open = 'OPEN', closed = 'CLOSED'", 'open = -1, closed = 0');

    const result = mapping(text, 'new Status(Stage.open)');

    expect(result).toEqual({ kind: 'known', token: '-1' });
  });

  it('does not treat a setter-only member as a scalar getter', () => {
    const text = source.replace('get value(): Stage { return this.props.value; }', 'set value(value: Stage) { this.props.value = value; }');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('rejects a factory overload without claiming that its implementation is resolved', () => {
    const text = source.replace('  static create(value: Stage): Status {', '  static create(value: Stage): Status;\n  static create(value: Stage): Status {');

    const result = mapping(text);

    expect(result.kind).toBe('unresolved');
  });
});

describe('prototype-sensitive storage', () => {
  it('does not treat a colon-form prototype setter as an own data slot', () => {
    const text = source.replace('interface StatusProps { value: Stage }', 'interface StatusProps { __proto__: Stage }')
      .replace('super({ value });', 'super({ __proto__: value });').replaceAll('this.props.value', 'this.props.__proto__');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('distinguishes shorthand data property creation from the prototype setter', () => {
    const text = source.replace(/\bvalue\b/g, '__proto__');
    const { cls } = sample(text);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('proven');
  });

  it('does not assume a declaration makes the legacy prototype holder a data property', () => {
    const { cls, project } = sample(source.replaceAll('props', '__proto__'));
    project.compilerOptions.set({ target: ScriptTarget.ES2020, useDefineForClassFields: false });

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });
});

describe('namespace reference evaluation', () => {
  const inNamespace = `namespace Box { ${source} }\ndeclare function expose(): typeof Box;`;

  const namespaceSample = (expression: string, text = inNamespace) => {
    const fixture = sample();
    const file = fixture.project.createSourceFile('/namespaced.ts', `${text}\nconst assigned = ${expression};`);
    const cls = file.getModuleOrThrow('Box').getClassOrThrow('Status');
    const proof = proveScalarProjection(cls.getType());
    if (proof.kind === 'unsupported') throw new Error(proof.reason);
    return mapProjectedValue(file.getVariableDeclarationOrThrow('assigned').getInitializerOrThrow(), proof.projection);
  };

  it('maps a symbol-resolved namespace qualified constructor and enum', () => {
    const result = namespaceSample('new Box.Status(Box.Stage.open)');

    expect(result).toEqual({ kind: 'known', token: 'OPEN' });
  });

  it('maps a symbol-resolved namespace qualified factory', () => {
    const result = namespaceSample('Box.Status.create(Box.Stage.closed)');

    expect(result).toEqual({ kind: 'known', token: 'CLOSED' });
  });

  it('does not treat an effectful enum qualifier as a scalar literal', () => {
    const result = namespaceSample('new Box.Status(expose().Stage.open)');

    expect(result.kind).toBe('unresolved');
  });

  it('does not treat an effectful class qualifier as an exact factory receiver', () => {
    const result = namespaceSample('expose().Status.create(Box.Stage.open)');

    expect(result.kind).toBe('unresolved');
  });

  it('does not trust a variable typed as a namespace as a pure enum qualifier', () => {
    const result = namespaceSample('new Box.Status(other.Stage.open)', `${inNamespace}\ndeclare const other: typeof Box;`);

    expect(result.kind).toBe('unresolved');
  });

  it('does not trust an effectful enum qualifier in constructor validation', () => {
    const fixture = sample();
    const text = inNamespace.replace('Object.values(Stage)', 'Object.values(expose().Stage)');
    const file = fixture.project.createSourceFile('/validation.ts', text);
    const cls = file.getModuleOrThrow('Box').getClassOrThrow('Status');

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it('does not trust an effectful qualifier in a superclass expression', () => {
    const fixture = sample();
    const text = inNamespace.replace('abstract class RecordBase', 'export abstract class RecordBase')
      .replace('extends RecordBase<StatusProps>', 'extends expose().RecordBase<StatusProps>');
    const file = fixture.project.createSourceFile('/heritage.ts', text);
    const cls = file.getModuleOrThrow('Box').getClassOrThrow('Status');

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });

  it.each(['__proto__', "'__proto__'"])('does not assume enum member %s has ordinary runtime data semantics', name => {
    const { cls } = sample(source.replace("open = 'OPEN'", `${name} = 'OPEN'`));

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });
});

describe('module namespace imports', () => {
  it('preserves declaration identity through a pure module namespace qualifier', () => {
    const fixture = sample();
    const file = fixture.project.createSourceFile('/namespace-consumer.ts', "import * as values from './status'; const assigned = values.Status.create(values.Stage.closed);");
    const proof = proveScalarProjection(fixture.cls.getType());
    if (proof.kind === 'unsupported') throw new Error(proof.reason);

    const result = mapProjectedValue(file.getVariableDeclarationOrThrow('assigned').getInitializerOrThrow(), proof.projection);

    expect(result).toEqual({ kind: 'known', token: 'CLOSED' });
  });
});

describe('class member parameter decorators', () => {
  const decorator = `
function replaceGetter(target: object, key: string | symbol | undefined, index: number): void {
  const receiver = Reflect.get(target, 'prototype') ?? target;
  Object.defineProperty(receiver, 'value', { configurable: true, get() { return Stage.closed; } });
}
`;
  const cases = [
    ['instance method', '  isClosed()', 'unrelated(@replaceGetter value: string): string { return value; }'],
    ['static method', '  isClosed()', 'static unrelated(@replaceGetter value: string): string { return value; }'],
    ['instance accessor', '  isClosed()', 'set unrelated(@replaceGetter value: string) { void value; }'],
    ['static accessor', '  isClosed()', 'static set unrelated(@replaceGetter value: string) { void value; }'],
    ['inherited instance method', '  constructor(props: T)', 'unrelated(@replaceGetter value: string): string { return value; }'],
    ['inherited static method', '  constructor(props: T)', 'static unrelated(@replaceGetter value: string): string { return value; }'],
    ['inherited instance accessor', '  constructor(props: T)', 'set unrelated(@replaceGetter value: string) { void value; }'],
    ['inherited static accessor', '  constructor(props: T)', 'static set unrelated(@replaceGetter value: string) { void value; }'],
  ] as const;

  const decoratedFixture = (location: string, member: string) => {
    const text = source.replace(location, `${member}\n${location}`) + decorator;
    const project = inMemoryProject({ '/status.ts': text }, { experimentalDecorators: true });
    return { project, cls: project.getSourceFileOrThrow('/status.ts').getClassOrThrow('Status') };
  };

  it.each(cases)('uses a diagnostic-free %s decorator reproduction', (_name, location, member) => {
    const { project } = decoratedFixture(location, member);

    const diagnostics = project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText());

    expect(diagnostics).toEqual([]);
  });

  it.each(cases)('rejects an unrelated %s whose parameter decorator can replace the scalar getter', (_name, location, member) => {
    const { cls } = decoratedFixture(location, member);

    const proof = proveScalarProjection(cls.getType());

    expect(proof.kind).toBe('unsupported');
  });
});
