import { StateField, StateValue } from '../analyzers/lifecycle/model';
import { FieldSuggestion, LifecycleSuggestion, SeededTransitions, TransitionSeed } from '../analyzers/lifecycle/suggest';
import { toPosixRelative } from '../engine/path';
import { Io } from './io';

type Interpretation<T> = { readonly kind: 'valid'; readonly value: T } | { readonly kind: 'invalid'; readonly message: string };

type Decision = 'accept' | 'reject' | 'edit';

type EntrySubject = { readonly noun: string; readonly name: string };

const valid = <T>(value: T): Interpretation<T> => ({ kind: 'valid', value });

const invalid = <T>(message: string): Interpretation<T> => ({ kind: 'invalid', message });

const DECISIONS: ReadonlyMap<string, Decision> = new Map([
  ['', 'accept'],
  ['y', 'accept'],
  ['yes', 'accept'],
  ['n', 'reject'],
  ['no', 'reject'],
  ['e', 'edit'],
  ['edit', 'edit'],
]);

const NO_VALUES = '-';

const interpretDecision = (answer: string): Interpretation<Decision> => {
  const decision = DECISIONS.get(answer.trim().toLowerCase());
  return decision === undefined ? invalid('Answer y, n or e.\n') : valid(decision);
};

const inOrder = <T, R>(items: readonly T[], step: (item: T) => Promise<R>): Promise<readonly R[]> =>
  items.reduce<Promise<readonly R[]>>(async (done, item) => [...(await done), await step(item)], Promise.resolve([]));

const labelsOf = (values: readonly StateValue[]): string => values.map((value) => value.label).join(', ');

const quoted = (labels: readonly string[]): string => labels.map((label) => `"${label}"`).join(', ');

const terminalSubject = (field: StateField): EntrySubject => ({ noun: 'terminal value', name: field.name });

const transitionSubject = (field: StateField, seed: TransitionSeed): EntrySubject => ({
  noun: 'value',
  name: `${field.name} transitions.${seed.method}`,
});

const unknownValuesMessage = (field: StateField, subject: EntrySubject, unknown: readonly string[]): string =>
  `Unknown ${subject.noun}${unknown.length === 1 ? '' : 's'} ${quoted(unknown)} for ${subject.name}; known values: ${labelsOf(field.values)}.\n`;

const noValueMessage = (subject: EntrySubject): string =>
  `No ${subject.noun} given for ${subject.name}; type known values separated by commas, ${NO_VALUES} for none, or press Enter to keep the suggestion.\n`;

const typedValues = (field: StateField, subject: EntrySubject, labels: readonly string[]): Interpretation<readonly StateValue[]> => {
  if (labels.length === 0) return invalid(noValueMessage(subject));
  const unknown = [...new Set(labels.filter((label) => !field.values.some((value) => value.label === label)))];
  if (unknown.length > 0) return invalid(unknownValuesMessage(field, subject, unknown));
  return valid(field.values.filter((value) => labels.includes(value.label)));
};

const valuesLabelled = (field: StateField, label: string): readonly StateValue[] =>
  field.values.filter((value) => value.label === label);

const interpretValuesEntry = (
  field: StateField,
  subject: EntrySubject,
  suggested: readonly StateValue[],
  entry: string,
): Interpretation<readonly StateValue[]> => {
  const trimmed = entry.trim();
  if (trimmed === '') return valid(suggested);
  if (trimmed === NO_VALUES) return valid([]);
  const labelled = valuesLabelled(field, trimmed);
  if (labelled.length > 0) return valid(labelled);
  return typedValues(
    field,
    subject,
    trimmed
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label !== ''),
  );
};

const terminalLabels = (terminal: readonly StateValue[]): string => labelsOf(terminal) || 'none';

const methodNames = (methods: readonly { readonly method: string }[]): string => methods.map(({ method }) => method).join(', ');

const transitionsSummary = (transitions: SeededTransitions): string => {
  if (transitions.kind === 'seeded') return `; transitions: ${methodNames(transitions.entries)}`;
  if (transitions.kind === 'withheld') return `; transitions withheld: ${methodNames(transitions.methods)}`;
  return '';
};

const fieldSummary = ({ field, terminal, transitions }: FieldSuggestion): string =>
  `${field.name} [terminal: ${terminalLabels(terminal)}${transitionsSummary(transitions)}]`;

const declareQuestion = (suggestion: LifecycleSuggestion, root: string): string => {
  const fields = suggestion.fields.map(fieldSummary).join('; ');
  return `${suggestion.className} (${toPosixRelative(root, suggestion.file)}): ${fields}. Declare? [Y/n/e] `;
};

const currentLabels = (values: readonly StateValue[]): string => labelsOf(values) || NO_VALUES;

const entryHint = (field: StateField): string =>
  `(known: ${labelsOf(field.values)}; comma-separated, ${NO_VALUES} for none, Enter to keep): `;

const terminalQuestion = (suggestion: FieldSuggestion): string =>
  `${suggestion.field.name} terminal values [${currentLabels(suggestion.terminal)}] ${entryHint(suggestion.field)}`;

const transitionsQuestion = (field: StateField, entries: readonly TransitionSeed[]): string => {
  const listed = entries.map(({ method, from }) => `${method} from ${currentLabels(from)}`).join('; ');
  return `${field.name} transitions [${listed}]. Keep? [Y/n/e] `;
};

const transitionEntryQuestion = (field: StateField, seed: TransitionSeed): string =>
  `${field.name}: ${seed.method}() runs from [${currentLabels(seed.from)}] ${entryHint(field)}`;

const askUntilValid = async <T>(io: Io, question: string, interpret: (answer: string) => Interpretation<T>): Promise<T> => {
  const interpretation = interpret(await io.prompt(question));
  if (interpretation.kind === 'valid') return interpretation.value;
  io.err(interpretation.message);
  return askUntilValid(io, question, interpret);
};

const editSeed = async (field: StateField, seed: TransitionSeed, io: Io): Promise<TransitionSeed> => ({
  ...seed,
  from: await askUntilValid(io, transitionEntryQuestion(field, seed), (entry) =>
    interpretValuesEntry(field, transitionSubject(field, seed), seed.from, entry),
  ),
});

const reviewTransitions = async (field: StateField, transitions: SeededTransitions, io: Io): Promise<SeededTransitions> => {
  if (transitions.kind !== 'seeded') return transitions;
  const decision = await askUntilValid(io, transitionsQuestion(field, transitions.entries), interpretDecision);
  if (decision === 'reject') return { kind: 'none' };
  if (decision === 'edit') return { kind: 'seeded', entries: await inOrder(transitions.entries, (seed) => editSeed(field, seed, io)) };
  return transitions;
};

const editField = async (suggestion: FieldSuggestion, io: Io): Promise<FieldSuggestion> => {
  const terminal = await askUntilValid(io, terminalQuestion(suggestion), (entry) =>
    interpretValuesEntry(suggestion.field, terminalSubject(suggestion.field), suggestion.terminal, entry),
  );
  return { ...suggestion, terminal, transitions: await reviewTransitions(suggestion.field, suggestion.transitions, io) };
};

const editSuggestion = async (suggestion: LifecycleSuggestion, io: Io): Promise<LifecycleSuggestion> => ({
  ...suggestion,
  fields: await inOrder(suggestion.fields, (field) => editField(field, io)),
});

const reviewSuggestion = async (suggestion: LifecycleSuggestion, io: Io, root: string): Promise<readonly LifecycleSuggestion[]> => {
  const decision = await askUntilValid(io, declareQuestion(suggestion, root), interpretDecision);
  if (decision === 'reject') return [];
  if (decision === 'edit') return [await editSuggestion(suggestion, io)];
  return [suggestion];
};

export const reviewSuggestions = (suggestions: readonly LifecycleSuggestion[], io: Io, root: string): Promise<readonly LifecycleSuggestion[]> =>
  suggestions.reduce<Promise<readonly LifecycleSuggestion[]>>(
    async (accepted, suggestion) => [...(await accepted), ...(await reviewSuggestion(suggestion, io, root))],
    Promise.resolve([]),
  );
