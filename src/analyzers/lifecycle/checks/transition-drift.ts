import { LifecycleFinding, ReportedRule, reportedUnder } from '../../../analyzer';
import { AggregateModel, FieldBehaviour, MethodModel, StateField } from '../model';
import { writesField } from '../values';
import { fieldOf, quoted } from './format';
import { TRANSITION_DRIFT, TRANSITION_MISSING } from './rules';

type Drift = {
  readonly rule: ReportedRule<'transition-drift' | 'transition-missing'>;
  readonly subject: string;
  readonly message: string;
  readonly fix: string;
};

const toFinding = (aggregate: AggregateModel, field: StateField, method: MethodModel, drift: Drift): LifecycleFinding => ({
  analyzer: 'lifecycle',
  aggregate: aggregate.name,
  aggregateId: aggregate.id,
  method: method.name,
  field: field.name,
  file: method.file,
  line: method.line,
  ...drift.rule,
  subject: drift.subject,
  message: drift.message,
  fix: drift.fix,
});

const comparedWithDeclaration = (
  field: StateField,
  method: MethodModel,
  behaviour: FieldBehaviour,
  declared: ReadonlySet<string>,
): Drift[] => {
  if (behaviour.sources.kind === 'unknown') return [];
  const allowed = behaviour.sources.values;
  const extra = [...allowed].filter((token) => !declared.has(token));
  const missing = [...declared].filter((token) => !allowed.has(token));
  return [
    ...(extra.length > 0
      ? [
          {
            rule: reportedUnder(TRANSITION_DRIFT),
            subject: 'extra',
            message: `${method.name}() can run from ${quoted(field, extra)}, which the declaration does not allow.`,
            fix: `Add a guard that excludes ${quoted(field, extra)}, or add ${extra.length === 1 ? 'it' : 'them'} to transitions.${method.name}.`,
          },
        ]
      : []),
    ...(missing.length > 0
      ? [
          {
            rule: reportedUnder(TRANSITION_MISSING),
            subject: 'missing',
            message: `${method.name}() cannot run from ${quoted(field, missing)}, although the declaration allows it.`,
            fix: `Remove ${quoted(field, missing)} from transitions.${method.name}, or relax the guard.`,
          },
        ]
      : []),
  ];
};

const driftOf = (field: StateField, method: MethodModel, transitions: ReadonlyMap<string, ReadonlySet<string>>): Drift[] => {
  const behaviour = method.fields.get(field.name);
  if (!behaviour) return [];
  const declared = transitions.get(method.name);
  if (declared) return comparedWithDeclaration(field, method, behaviour, declared);
  if (!writesField(behaviour.sets)) return [];
  return [
    {
      rule: reportedUnder(TRANSITION_DRIFT),
      subject: 'undeclared',
      message: `${method.name}() sets ${field.name} but has no entry in transitions.`,
      fix: `Add transitions.${method.name} to the declaration.`,
    },
  ];
};

export const transitionDrift = (aggregate: AggregateModel): LifecycleFinding[] =>
  [...aggregate.declarations].flatMap(([name, declaration]) => {
    const transitions = declaration.transitions;
    if (!transitions) return [];
    const field = fieldOf(aggregate, name);
    return aggregate.methods
      .filter((method) => method.visibility === 'public')
      .flatMap((method) => driftOf(field, method, transitions).map((drift) => toFinding(aggregate, field, method, drift)));
  });
