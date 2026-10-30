import { FieldSuggestion, LifecycleSuggestion, WithheldMethod, WithheldReason } from '../analyzers/lifecycle/suggest';

type MethodList = { readonly names: string; readonly plural: boolean };

const CLAUSES: Readonly<Record<WithheldReason, (methods: MethodList) => string>> = {
  'unknown-sources': ({ names, plural }) => `init cannot tell which states ${names} ${plural ? 'run' : 'runs'} from`,
  'unwritable-name': ({ names }) => `${names} cannot be named in transitions`,
};

const calls = (methods: readonly string[]): readonly string[] => methods.map((method) => `${method}()`);

const listed = (methods: readonly string[]): MethodList => {
  const named = calls(methods);
  const last = named.at(-1) ?? '';
  return { names: named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${last}` : last, plural: named.length > 1 };
};

const reasonsInOrder = (methods: readonly WithheldMethod[]): readonly WithheldReason[] =>
  methods.map(({ reason }) => reason).filter((reason, index, reasons) => reasons.indexOf(reason) === index);

const methodsWithheldFor = (methods: readonly WithheldMethod[], reason: WithheldReason): readonly string[] =>
  methods.filter((withheld) => withheld.reason === reason).map(({ method }) => method);

const clauses = (methods: readonly WithheldMethod[]): readonly string[] =>
  reasonsInOrder(methods).map((reason) => CLAUSES[reason](listed(methodsWithheldFor(methods, reason))));

const fieldNote = (className: string, { field, transitions }: FieldSuggestion): readonly string[] =>
  transitions.kind === 'withheld'
    ? [`No transitions seeded for ${className}.${field.name}: ${clauses(transitions.methods).join('; ')}.`]
    : [];

export const withheldTransitionsNotes = (suggestions: readonly LifecycleSuggestion[]): readonly string[] =>
  suggestions.flatMap(({ className, fields }) => fields.flatMap((field) => fieldNote(className, field)));
