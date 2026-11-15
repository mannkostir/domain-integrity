import { describe, expect, it } from 'vitest';
import { inMemoryProject } from '../../helpers/in-memory';
import { proveScalarProjection } from '../../../src/analyzers/lifecycle/value-object/projection';
import { proveWrapperPredicate, evaluateWrapperPredicate, wrapperPredicateSources } from '../../../src/analyzers/lifecycle/value-object/predicate';

const names = ['PENDING', 'NEED_TO_PAY', 'APPROVED', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;
const transitions: Readonly<Record<string, readonly string[]>> = {
  PENDING: ['NEED_TO_PAY', 'FAILED', 'CANCELLED'],
  NEED_TO_PAY: ['APPROVED', 'FAILED', 'CANCELLED'],
  APPROVED: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: ['REFUNDED'],
  FAILED: [], CANCELLED: [], REFUNDED: [],
};
const transitionBody = `
const currentStatus = this.props.value;
switch (currentStatus) {
  case Stage.PENDING: return [Stage.NEED_TO_PAY, Stage.FAILED, Stage.CANCELLED].includes(newStatus);
  case Stage.NEED_TO_PAY: return [Stage.APPROVED, Stage.FAILED, Stage.CANCELLED].includes(newStatus);
  case Stage.APPROVED: return [Stage.COMPLETED, Stage.FAILED, Stage.CANCELLED].includes(newStatus);
  case Stage.COMPLETED: return [Stage.REFUNDED].includes(newStatus);
  case Stage.FAILED:
  case Stage.CANCELLED:
  case Stage.REFUNDED: return false;
  default: return false;
}
`;
const source = `
export enum Stage { ${names.map(name => `${name} = '${name}'`).join(', ')} }
interface StatusProps { value: Stage }
abstract class RecordBase<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
}
export class Status extends RecordBase<StatusProps> {
  constructor(value: Stage) { super({ value }); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  ${names.map(name => `is${name}(): boolean { return this.props.value === Stage.${name}; }`).join('\n')}
  canTransitionTo(newStatus: Stage): boolean { ${transitionBody} }
}
${names.map(name => `const target${name} = Stage.${name};`).join('\n')}
`;

const setup = (text = source) => {
  const project = inMemoryProject({ '/status.ts': text });
  const file = project.getSourceFileOrThrow('/status.ts');
  const cls = file.getClassOrThrow('Status');
  const proof = proveScalarProjection(cls.getType());
  if (proof.kind === 'unsupported') throw new Error(proof.reason);
  return {
    project, file, cls, projection: proof.projection,
    target: (name: string) => file.getVariableDeclarationOrThrow(`target${name}`).getInitializerOrThrow(),
    current: (name: string) => {
      const value = proof.projection.values.find(value => value.label === name);
      if (value === undefined) throw new Error(`missing current ${name}`);
      return value;
    },
  };
};
const fixture = setup();
const transition = proveWrapperPredicate(fixture.cls.getMethodOrThrow('canTransitionTo'), fixture.projection);
const pairs = names.flatMap(current => names.map(target => [current, target] as const));

describe('wrapper transition predicate', () => {
  it('proves the exact immutable snapshot and complete switch grammar', () => {
    expect(transition.kind).toBe('proven');
  });

  it.each(pairs)('evaluates current %s and target %s', (current, target) => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);

    const result = evaluateWrapperPredicate(transition.predicate, fixture.current(current), [fixture.target(target)]);

    expect(result).toEqual({ kind: 'known', value: transitions[current]!.includes(target) });
  });

  it.each(names)('collects complete source sets for target %s', target => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);

    const result = wrapperPredicateSources(transition.predicate, [fixture.target(target)]);

    expect(result).toEqual({
      kind: 'known',
      whenTrue: new Set(names.filter(current => transitions[current]!.includes(target))),
      whenFalse: new Set(names.filter(current => !transitions[current]!.includes(target))),
    });
  });
});

describe('wrapper equality predicates', () => {
  it.each(pairs)('evaluates is%s for current %s', (predicateName, current) => {
    const proof = proveWrapperPredicate(fixture.cls.getMethodOrThrow(`is${predicateName}`), fixture.projection);
    if (proof.kind === 'unknown') throw new Error(proof.reason);

    const result = evaluateWrapperPredicate(proof.predicate, fixture.current(current), []);

    expect(result).toEqual({ kind: 'known', value: predicateName === current });
  });
});

const bodyProof = (body: string, text = source) => {
  const sample = setup(text.replace(transitionBody, body));
  return proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);
};

describe('unsupported wrapper predicate bodies', () => {
  it.each([
    ['loop', 'while (true) { return false; }'],
    ['conditional alternate returns', 'if (newStatus === Stage.PENDING) return true; return false;'],
    ['extra return', 'return true; return false;'],
    ['closure', 'return (() => this.props.value === Stage.PENDING)();'],
    ['unknown call', 'return validate(this.props.value, newStatus);'],
    ['recursive call', 'return this.canTransitionTo(newStatus);'],
    ['foreign receiver', 'return other.props.value === Stage.PENDING;'],
    ['different slot', 'return this.props.other === Stage.PENDING;'],
    ['accessor read', 'return this.effectful;'],
    ['non-strict equality', 'return this.props.value == Stage.PENDING;'],
    ['foreign enum', 'return this.props.value === OtherStage.PENDING;'],
    ['effectful enum qualifier', 'return this.props.value === expose().E.PENDING;'],
    ['property with literal type', 'return this.props.value === other.literal;'],
    ['nested scalar getter', 'return this.value === Stage.PENDING;'],
    ['assignment expression', 'return (this.props.value = Stage.PENDING) === Stage.PENDING;'],
    ['mutable local', transitionBody.replace('const currentStatus', 'let currentStatus')],
    ['multiple locals', transitionBody.replace('const currentStatus = this.props.value;', 'const currentStatus = this.props.value, extra = newStatus;')],
    ['destructured snapshot', transitionBody.replace('const currentStatus = this.props.value;', 'const { value: currentStatus } = this.props;')],
    ['foreign snapshot', transitionBody.replace('this.props.value', 'other.props.value')],
    ['snapshot transform', transitionBody.replace('this.props.value', 'transform(this.props.value)')],
    ['snapshot mutation', transitionBody.replace('this.props.value', 'this.props.value++')],
    ['parameter discriminant', transitionBody.replace('switch (currentStatus)', 'switch (newStatus)')],
    ['mutated discriminant', transitionBody.replace('switch (currentStatus)', 'switch (currentStatus = Stage.PENDING)')],
    ['pre-switch mutation', transitionBody.replace('switch (currentStatus)', 'this.props.value = Stage.PENDING; switch (currentStatus)')],
    ['missing default', transitionBody.replace('default: return false;', '')],
    ['missing return value', transitionBody.replace('default: return false;', 'default: return;')],
    ['fallthrough without a return', transitionBody.replace('default: return false;', 'default:')],
    ['break path', transitionBody.replace('default: return false;', 'default: break;')],
    ['throw path', transitionBody.replace('default: return false;', "default: throw new Error('x');")],
    ['extra branch effect', transitionBody.replace('default: return false;', 'default: effect(); return false;')],
    ['effect after return', transitionBody.replace('default: return false;', 'default: return false; effect();')],
    ['non-boolean return', transitionBody.replace('default: return false;', 'default: return newStatus;')],
    ['effectful label', transitionBody.replace('case Stage.PENDING:', 'case effect():')],
    ['duplicate label', transitionBody.replace('case Stage.NEED_TO_PAY:', 'case Stage.PENDING:')],
    ['effectful array element', 'return [effect()].includes(newStatus);'],
    ['spread element', 'return [...values].includes(newStatus);'],
    ['omitted array element', 'return [, Stage.PENDING].includes(newStatus);'],
    ['array alias', 'return values.includes(newStatus);'],
    ['string includes', "return 'PENDING'.includes(newStatus);"],
    ['parameter mutation', 'return [Stage.PENDING].includes(newStatus = Stage.PENDING);'],
    ['extra includes argument', 'return [Stage.PENDING].includes(newStatus, effect());'],
    ['missing includes argument', 'return [Stage.PENDING].includes();'],
    ['optional includes call', 'return [Stage.PENDING].includes?.(newStatus);'],
    ['optional includes member', 'return [Stage.PENDING]?.includes(newStatus);'],
    ['literal typed local', 'return [literal].includes(newStatus);'],
  ])('withholds %s', (_name, body) => {
    const text = `${source}\ndeclare const other: Status & { literal: Stage.PENDING };\nenum OtherStage { PENDING = 'PENDING' }\nnamespace Holder { export import E = Stage; }\ndeclare function expose(): typeof Holder;`;

    const result = bodyProof(body, text);

    expect(result.kind).toBe('unknown');
  });

  it('does not treat a same-spelled outer local as the snapshot', () => {
    const text = `${source}\nconst currentStatus = Stage.PENDING;`;
    const body = transitionBody.replace('const currentStatus', 'const snapshot');

    const result = bodyProof(body, text);

    expect(result.kind).toBe('unknown');
  });

  it('rejects a custom includes declaration merged into the array library', () => {
    const sample = setup();
    sample.project.createSourceFile('/array-override.d.ts', 'interface Array<T> { includes(searchElement: T, fromIndex?: number): boolean; }');

    const result = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);

    expect(result.kind).toBe('unknown');
  });
});

describe('method implementation boundaries', () => {
  it.each([
    ['static', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').setIsStatic(true)],
    ['async', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').setIsAsync(true)],
    ['generator', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').setIsGenerator(true)],
    ['method decorator', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').addDecorator({ name: 'decorate' })],
    ['parameter decorator', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.addDecorator({ name: 'decorate' })],
    ['default parameter', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.setInitializer('effect()')],
    ['rest parameter', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.setIsRestParameter(true)],
    ['optional parameter', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.setHasQuestionToken(true)],
    ['wrong parameter type', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.setType('string')],
    ['unknown parameter type', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').getParameters()[0]!.setType('any')],
    ['extra parameter', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').addParameter({ name: 'extra', type: 'Stage' })],
    ['overload', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').addOverload({ parameters: [{ name: 'newStatus', type: 'Stage' }], returnType: 'boolean' })],
    ['type parameter', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').addTypeParameter('T')],
    ['unproved return type', (sample: ReturnType<typeof setup>) => sample.cls.getMethodOrThrow('canTransitionTo').setReturnType('any')],
  ] as const)('withholds a method with %s', (_name, change) => {
    const sample = setup();
    change(sample);

    const result = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);

    expect(result.kind).toBe('unknown');
  });

  it('rejects a method from another class with the same name and body', () => {
    const other = setup();

    const result = proveWrapperPredicate(other.cls.getMethodOrThrow('canTransitionTo'), fixture.projection);

    expect(result.kind).toBe('unknown');
  });

  it('rejects declaration-only methods', () => {
    const sample = setup();
    const file = sample.project.createSourceFile('/library.d.ts', 'declare class Library { canTransitionTo(newStatus: unknown): boolean; }');

    const result = proveWrapperPredicate(file.getClassOrThrow('Library').getMethodOrThrow('canTransitionTo'), sample.projection);

    expect(result.kind).toBe('unknown');
  });

  it('keeps dispatch and observable receiver safety as explicit obligations', () => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);

    expect(transition.predicate.requires).toEqual(['observable-mutation-and-escape-analysis', 'dispatch-invalidation']);
  });

  it('does not claim runtime receiver safety from a proven body', () => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);

    expect(transition.predicate.scope).toBe('local-wrapper-predicate-body');
  });

  it('proves an arbitrary method name by its body', () => {
    const sample = setup(source.replace('canTransitionTo(', 'arbitrary('));

    const result = proveWrapperPredicate(sample.cls.getMethodOrThrow('arbitrary'), sample.projection);

    expect(result.kind).toBe('proven');
  });
});

describe('known scalar argument requirements', () => {
  it.each([
    ['broad enum', 'declaredStage'],
    ['broad string', 'declaredString'],
    ['asserted broad string', 'declaredString as Stage'],
    ['raw string', "'PENDING'"],
    ['foreign enum', 'OtherStage.PENDING'],
    ['effectful enum qualifier', 'expose().E.PENDING'],
    ['literal typed call', 'literalStage()'],
    ['literal typed getter', 'holder.value'],
    ['unknown token', 'Stage.NOT_A_STATE'],
  ])('withholds target %s', (_name, expression) => {
    const text = `${source}\ndeclare const declaredStage: Stage; declare const declaredString: string;\nenum OtherStage { PENDING = 'PENDING' }\nnamespace Holder { export import E = Stage; }\ndeclare function expose(): typeof Holder;\ndeclare function literalStage(): Stage.PENDING;\ndeclare const holder: { readonly value: Stage.PENDING };\nconst argument = ${expression};`;
    const sample = setup(text);
    const proof = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);
    if (proof.kind === 'unknown') throw new Error(proof.reason);

    const result = evaluateWrapperPredicate(proof.predicate, sample.current('PENDING'), [sample.file.getVariableDeclarationOrThrow('argument').getInitializerOrThrow()]);

    expect(result.kind).toBe('unknown');
  });

  it('rejects a current token paired with the wrong member identity', () => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);
    const current = { ...fixture.current('PENDING'), token: 'APPROVED' };

    const result = evaluateWrapperPredicate(transition.predicate, current, [fixture.target('APPROVED')]);

    expect(result.kind).toBe('unknown');
  });

  it('rejects a current member from another enum even when its token matches', () => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);
    const other = setup();

    const result = evaluateWrapperPredicate(transition.predicate, other.current('PENDING'), [fixture.target('APPROVED')]);

    expect(result.kind).toBe('unknown');
  });

  it('does not produce partial source sets for unknown input', () => {
    if (transition.kind === 'unknown') throw new Error(transition.reason);

    const result = wrapperPredicateSources(transition.predicate, []);

    expect(result.kind).toBe('unknown');
  });

  it('rejects extra arguments even for a parameterless predicate', () => {
    const proof = proveWrapperPredicate(fixture.cls.getMethodOrThrow('isPENDING'), fixture.projection);
    if (proof.kind === 'unknown') throw new Error(proof.reason);

    const result = evaluateWrapperPredicate(proof.predicate, fixture.current('PENDING'), [fixture.target('PENDING')]);

    expect(result.kind).toBe('unknown');
  });
});

describe('bounded local evaluation', () => {
  it('accepts bounded parentheses in a pure expression', () => {
    const result = bodyProof('return ((((this.props.value === Stage.PENDING))));');

    expect(result.kind).toBe('proven');
  });

  it('withholds expression nesting beyond the depth bound', () => {
    const result = bodyProof(`return ${'('.repeat(10)}this.props.value === Stage.PENDING${')'.repeat(10)};`);

    expect(result.kind === 'unknown' ? result.reason : result.kind).toContain('bound');
  });

  it('withholds literal arrays beyond the work bound', () => {
    const result = bodyProof(`return [${Array.from({ length: 300 }, () => 'Stage.PENDING').join(', ')}].includes(newStatus);`);

    expect(result.kind === 'unknown' ? result.reason : result.kind).toContain('bound');
  });

  it('withholds an oversized finite domain', () => {
    const extra = Array.from({ length: 250 }, (_, index) => `EXTRA${index} = 'EXTRA${index}'`).join(', ');
    const sample = setup(source.replace("REFUNDED = 'REFUNDED'", `REFUNDED = 'REFUNDED', ${extra}`));

    const result = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);

    expect(result.kind === 'unknown' ? result.reason : result.kind).toContain('bound');
  });

  it('does not conflate string and numeric enum members sharing a token spelling', () => {
    const text = source.replace("PENDING = 'PENDING'", 'PENDING = 0').replace("APPROVED = 'APPROVED'", "APPROVED = '0'");
    const sample = setup(text);

    const result = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);

    expect(result.kind === 'unknown' ? result.reason : result.kind).toContain('ambiguous');
  });
});

describe('complete pure return paths', () => {
  it.each([
    ['default first', 'default: return true; case Stage.PENDING: return false;', ['NEED_TO_PAY', 'APPROVED', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED']],
    ['default middle', 'case Stage.PENDING: return true; default: return false; case Stage.REFUNDED: return true;', ['PENDING', 'REFUNDED']],
    ['default grouped with a case', 'default: case Stage.PENDING: return true; case Stage.REFUNDED: return false;', ['PENDING', 'NEED_TO_PAY', 'APPROVED', 'COMPLETED', 'FAILED', 'CANCELLED']],
    ['case grouped with default', 'case Stage.PENDING: default: return true; case Stage.REFUNDED: return false;', ['PENDING', 'NEED_TO_PAY', 'APPROVED', 'COMPLETED', 'FAILED', 'CANCELLED']],
  ] as const)('collects all source states with %s', (_name, clauses, allowed) => {
    const proof = bodyProof(`const current = this.props.value; switch (current) { ${clauses} }`);
    if (proof.kind === 'unknown') throw new Error(proof.reason);
    const sample = proof.predicate.projection;
    const argument = sample.enumDeclaration.getSourceFile().getVariableDeclarationOrThrow('targetPENDING').getInitializerOrThrow();

    const result = wrapperPredicateSources(proof.predicate, [argument]);

    expect(result).toEqual({ kind: 'known', whenTrue: new Set(allowed), whenFalse: new Set(names.filter(name => !allowed.some(value => value === name))) });
  });

  it.each([true, false])('evaluates a direct Boolean return %s without inventing a state read', value => {
    const proof = bodyProof(`return ${value};`);
    if (proof.kind === 'unknown') throw new Error(proof.reason);
    const argument = proof.predicate.projection.enumDeclaration.getSourceFile().getVariableDeclarationOrThrow('targetPENDING').getInitializerOrThrow();

    const result = wrapperPredicateSources(proof.predicate, [argument]);

    expect(result).toEqual({ kind: 'known', whenTrue: new Set(value ? names : []), whenFalse: new Set(value ? [] : names) });
  });

  it('evaluates a commuted comparison by receiver and enum identity', () => {
    const sample = setup(source.replace('return this.props.value === Stage.PENDING;', 'return Stage.PENDING === this.props.value;'));
    const proof = proveWrapperPredicate(sample.cls.getMethodOrThrow('isPENDING'), sample.projection);
    if (proof.kind === 'unknown') throw new Error(proof.reason);

    const result = evaluateWrapperPredicate(proof.predicate, sample.current('PENDING'), []);

    expect(result).toEqual({ kind: 'known', value: true });
  });

  it('recognizes a genuine enum alias in a pure namespace path', () => {
    const text = `${source}\nnamespace Holder { export import E = Stage; }`;
    const proof = bodyProof('return this.props.value === Holder.E.PENDING;', text);
    if (proof.kind === 'unknown') throw new Error(proof.reason);
    const argument = proof.predicate.projection.enumDeclaration.getSourceFile().getVariableDeclarationOrThrow('targetPENDING').getInitializerOrThrow();

    const result = wrapperPredicateSources(proof.predicate, [argument]);

    expect(result.kind === 'known' ? result.whenTrue : result).toEqual(new Set(['PENDING']));
  });

  it('withholds an argument beyond the parenthesis depth bound', () => {
    const sample = setup(`${source}\nconst nested = ${'('.repeat(10)}Stage.PENDING${')'.repeat(10)};`);
    const proof = proveWrapperPredicate(sample.cls.getMethodOrThrow('canTransitionTo'), sample.projection);
    if (proof.kind === 'unknown') throw new Error(proof.reason);

    const result = evaluateWrapperPredicate(proof.predicate, sample.current('PENDING'), [sample.file.getVariableDeclarationOrThrow('nested').getInitializerOrThrow()]);

    expect(result.kind === 'unknown' ? result.reason : result.kind).toContain('bound');
  });
});
