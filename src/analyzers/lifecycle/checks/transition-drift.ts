import { reportedUnder } from '../../../analyzer';
import { FindingOf } from '../../../finding';
import { AggregateModel, FieldBehaviour, MethodModel, StateField } from '../model';
import { writesField } from '../values';
import { fieldOf, quoted } from './format';
import { TRANSITION_DRIFT, TRANSITION_MISSING } from './rules';

type Site = { readonly aggregate: AggregateModel; readonly field: StateField; readonly method: MethodModel };

type TransitionFinding = FindingOf<'transition-drift'> | FindingOf<'transition-missing'>;

const placed = ({ method }: Site) => ({ analyzer: 'lifecycle' as const, file: method.file, line: method.line });

const target = ({ aggregate, field, method }: Site) => ({ aggregate: aggregate.name, aggregateId: aggregate.id, method: method.name, field: field.name });

const extraFinding = (site: Site, extra: readonly string[]): FindingOf<'transition-drift'> => ({
  ...reportedUnder(TRANSITION_DRIFT),
  ...placed(site),
  message: `${site.method.name}() can run from ${quoted(site.field, extra)}, which the declaration does not allow.`,
  fix: `Add a guard that excludes ${quoted(site.field, extra)}, or add ${extra.length === 1 ? 'it' : 'them'} to transitions.${site.method.name}.`,
  details: { ...target(site), kind: 'extra', values: extra },
});

const missingFinding = (site: Site, missing: readonly string[]): FindingOf<'transition-missing'> => ({
  ...reportedUnder(TRANSITION_MISSING),
  ...placed(site),
  message: `${site.method.name}() cannot run from ${quoted(site.field, missing)}, although the declaration allows it.`,
  fix: `Remove ${quoted(site.field, missing)} from transitions.${site.method.name}, or relax the guard.`,
  details: { ...target(site), values: missing },
});

const undeclaredFinding = (site: Site): FindingOf<'transition-drift'> => ({
  ...reportedUnder(TRANSITION_DRIFT),
  ...placed(site),
  message: `${site.method.name}() sets ${site.field.name} but has no entry in transitions.`,
  fix: `Add transitions.${site.method.name} to the declaration.`,
  details: { ...target(site), kind: 'undeclared', values: [] },
});

const comparedWithDeclaration = (site: Site, behaviour: FieldBehaviour, declared: ReadonlySet<string>): TransitionFinding[] => {
  if (behaviour.sources.kind === 'unknown') return [];
  const allowed = behaviour.sources.values;
  const extra = [...allowed].filter((token) => !declared.has(token));
  const missing = [...declared].filter((token) => !allowed.has(token));
  return [...(extra.length > 0 ? [extraFinding(site, extra)] : []), ...(missing.length > 0 ? [missingFinding(site, missing)] : [])];
};

const driftOf = (site: Site, transitions: ReadonlyMap<string, ReadonlySet<string>>): TransitionFinding[] => {
  const behaviour = site.method.fields.get(site.field.name);
  if (!behaviour) return [];
  const declared = transitions.get(site.method.name);
  if (declared) return comparedWithDeclaration(site, behaviour, declared);
  return writesField(behaviour.sets) ? [undeclaredFinding(site)] : [];
};

export const transitionDrift = (aggregate: AggregateModel): TransitionFinding[] =>
  [...aggregate.declarations].flatMap(([name, declaration]) => {
    const transitions = declaration.transitions;
    if (!transitions) return [];
    const field = fieldOf(aggregate, name);
    return aggregate.methods
      .filter((method) => method.visibility === 'public')
      .flatMap((method) => driftOf({ aggregate, field, method }, transitions));
  });
