import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeAssigned, describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const privateField = "#state: 'open' | 'closed' = 'open';";
const privateSetter = "set label(value: 'open' | 'closed') { this.#state = value; }";
const privateMethod = "rename() { if (this.#state === 'open') return; this.label = 'closed'; }";
const virtualPrivateSource = `class Base {
  ${privateField}
  get label(): 'open' | 'closed' { return this.#state; }
  ${privateSetter}
  ${privateMethod}
}
class Order extends Base {
  #state: 'open' | 'closed' = 'closed';
  ${privateSetter}
}`;

const inspect = (source: string, fieldName = '#state') => {
  const project = inMemoryProject({ '/src/order.ts': source });
  const file = project.getSourceFileOrThrow('/src/order.ts');
  const cls = file.getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{
        target: cls,
        fields: [{ name: fieldName, terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }],
        allowAfterTerminal: [],
      }],
    },
    files: [file],
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return { project, cls, model, findings: lifecycleAnalyzer.check(model) };
};

const sourcesOf = (source: string, fieldName = '#state') => {
  const { model } = inspect(source, fieldName);
  return describeSources(model.aggregates[0]!.methods[0]!.fields.get(fieldName)!.sources);
};

describe('private entry guards with virtual state setters', () => {
  it('keeps an inherited guard on another private brand unknown', () => {
    expect(sourcesOf(virtualPrivateSource)).toBe('unknown');
  });

  it('does not report a terminal leak from the unrelated private guard', () => {
    expect(inspect(virtualPrivateSource).findings.filter((finding) => finding.ruleId === 'terminal-state-leak')).toEqual([]);
  });

  it('does not retain a resolved assigned value when private state identity is ambiguous', () => {
    const { model } = inspect(virtualPrivateSource);

    expect(describeAssigned(model.aggregates[0]!.methods[0]!.fields.get('#state')!.sets).tokens).toEqual([]);
  });

  it('typechecks the public override reproduction', () => {
    expect(inspect(virtualPrivateSource).project.getPreEmitDiagnostics()).toEqual([]);
  });

  it('preserves a transparent setter with a single inherited private brand', () => {
    const source = `class Base { ${privateField} ${privateSetter} ${privateMethod} } class Order extends Base {}`;

    expect(sourcesOf(source)).toEqual(['closed']);
  });

  it('preserves a transparent setter with a single own private brand', () => {
    expect(sourcesOf(`class Order { ${privateField} ${privateSetter} ${privateMethod} }`)).toEqual(['closed']);
  });

  it('withholds a derived method cutoff when its private spelling is also declared by a base', () => {
    expect(sourcesOf(`class Base { ${privateField} } class Order extends Base {
      ${privateField} ${privateSetter} ${privateMethod}
    }`)).toBe('unknown');
  });
});

const directSource = (props: string, assignment = 'this.props.status = value;', before = 'this.props.status', after = 'this.props.status') => `class Order {
  ${props}
  title = '';
  close(value: 'open' | 'closed') {
    if (${before} === 'open') return;
    ${assignment}
    if (${after} === 'open') return;
    this.title = 'x';
  }
}`;

const inferredProps = "props = { status: 'open' as 'open' | 'closed' };";
const inferredSource = directSource(inferredProps);

describe('ordinary data assignment cutoff declaration shapes', () => {
  it('retains the entry guard for an inferred props object', () => {
    expect(sourcesOf(inferredSource, 'status')).toEqual(['closed']);
  });

  it('retains the terminal leak after a direct inferred props write', () => {
    expect(inspect(inferredSource, 'status').findings.filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method)).toEqual(['close']);
  });

  it('typechecks the inferred props reproduction', () => {
    expect(inspect(inferredSource, 'status').project.getPreEmitDiagnostics()).toEqual([]);
  });

  it.each([
    [inferredProps, 'this.props.status = value;'],
    [inferredProps, "this.props['status'] = value;"],
    ["props: { status: 'open' | 'closed' } = { status: 'open' };", 'this.props.status = value;'],
    ["constructor(public props: { status: 'open' | 'closed' }) {}", 'this.props.status = value;'],
    ["status: 'open' | 'closed' = 'open';", 'this.status = value;'],
  ])('retains direct cutoff with %s and %s', (props, assignment) => {
    const access = assignment.startsWith('this.status') ? 'this.status' : 'this.props.status';

    expect(sourcesOf(directSource(props, assignment, access, access), 'status')).toEqual(['closed']);
  });

  it('retains cutoff with nested inferred data alongside the state', () => {
    const source = directSource("props = { nested: { value: 1 }, status: 'open' as 'open' | 'closed' };");

    expect(sourcesOf(source, 'status')).toEqual(['closed']);
  });

  it('retains a shorthand data property cutoff', () => {
    const source = `export {}; const status = 'open' as 'open' | 'closed'; ${directSource('props = { status };')}`;

    expect(sourcesOf(source, 'status')).toEqual(['closed']);
  });

  it('retains cutoff when props are inferred from nested plain data', () => {
    const source = directSource("data = { nested: { status: 'open' as 'open' | 'closed' } }; props = this.data.nested;");

    expect(sourcesOf(source, 'status')).toEqual(['closed']);
  });

  it('substitutes a setter value through nested inferred props data', () => {
    const source = directSource(`data = { nested: { status: 'open' as 'open' | 'closed' } }; props = this.data.nested;
      set state(value: 'open' | 'closed') { this.props.status = value; }`, "this.state = 'closed';");
    const { model } = inspect(source, 'status');

    expect(describeAssigned(model.aggregates[0]!.methods[0]!.fields.get('status')!.sets)).toEqual({ tokens: ['closed'], unresolved: false, mayWrite: false });
  });

  it('accepts inferred props as the destination of a transparent setter', () => {
    const source = directSource(`${inferredProps} set state(value: 'open' | 'closed') { this.props.status = value; }`, 'this.state = value;');

    expect(sourcesOf(source, 'status')).toEqual(['closed']);
  });

  it('does not give getter-returned props copies a cutoff', () => {
    const source = directSource("get props(): { status: 'open' | 'closed' } { return { status: 'open' }; }");

    expect(sourcesOf(source, 'status')).toBe('unknown');
  });

  it('does not give an accessor destination a cutoff', () => {
    const source = directSource(`data: 'open' | 'closed' = 'open';
      props = { get status(): 'open' | 'closed' { return 'open'; }, set status(value: 'open' | 'closed') {} };`);

    expect(sourcesOf(source, 'status')).toBe('unknown');
  });
});
