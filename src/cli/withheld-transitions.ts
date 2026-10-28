import { FieldSuggestion, LifecycleSuggestion, WithheldMethod, WithheldReason } from '../analyzers/lifecycle/suggest';

const CLAUSES: Readonly<Record<WithheldReason, (method: string, field: string) => string>> = {
  'unknown-sources': (method) => `init cannot tell which states ${method}() runs from`,
  'unlisted-source': (method, field) => `${method}() runs from a value that is not a state of ${field}`,
  'unwritable-name': (method) => `${method}() cannot be named in transitions`,
};

const clauseFor = ({ method, reason }: WithheldMethod, field: string): string => CLAUSES[reason](method, field);

const fieldNote = (className: string, { field, transitions }: FieldSuggestion): readonly string[] =>
  transitions.kind === 'withheld'
    ? [`No transitions seeded for ${className}.${field.name}: ${transitions.methods.map((method) => clauseFor(method, field.name)).join('; ')}.`]
    : [];

export const withheldTransitionsNotes = (suggestions: readonly LifecycleSuggestion[]): readonly string[] =>
  suggestions.flatMap(({ className, fields }) => fields.flatMap((field) => fieldNote(className, field)));
