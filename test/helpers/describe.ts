import { ClassDeclaration } from 'ts-morph';
import { AggregateScope } from '../../src/analyzers/lifecycle/field-ref';
import { AssignedValues, Sources, StateField } from '../../src/analyzers/lifecycle/model';
import { aggregateScope } from '../../src/analyzers/lifecycle/scope';
import { resolveStateField } from '../../src/analyzers/lifecycle/state-field';
import { DEFAULT_DECLARATION } from '../../src/engine/declaration';

export const defaultScope = (cls: ClassDeclaration): AggregateScope =>
  aggregateScope(cls, DEFAULT_DECLARATION.eventMethods, cls.getProject().getSourceFiles());

export const resolvedField = (cls: ClassDeclaration, name: string): StateField => {
  const resolution = resolveStateField(cls, name);
  if (resolution.kind === 'problem') throw new Error(resolution.message);
  return resolution.field;
};

export const describeSources = (sources: Sources): readonly string[] | 'unknown' =>
  sources.kind === 'unknown' ? 'unknown' : [...sources.values].sort();

export const describeAssigned = (value: AssignedValues): { tokens: string[]; unresolved: boolean; mayWrite: boolean } => ({
  tokens: [...value.tokens].sort(),
  unresolved: value.unresolved,
  mayWrite: value.mayWrite,
});
