import { StateField, StateValue } from '../analyzers/lifecycle/model';
import { FieldSuggestion, LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { toPosixRelative } from '../engine/path';
import { Io } from './io';

type Interpretation<T> = { readonly kind: 'valid'; readonly value: T } | { readonly kind: 'invalid'; readonly message: string };

type Decision = 'declare' | 'skip' | 'edit';

const valid = <T>(value: T): Interpretation<T> => ({ kind: 'valid', value });

const invalid = <T>(message: string): Interpretation<T> => ({ kind: 'invalid', message });

const DECISIONS: ReadonlyMap<string, Decision> = new Map([
  ['', 'declare'],
  ['y', 'declare'],
  ['yes', 'declare'],
  ['n', 'skip'],
  ['no', 'skip'],
  ['e', 'edit'],
  ['edit', 'edit'],
]);

const NO_TERMINAL_VALUES = '-';

const interpretDecision = (answer: string): Interpretation<Decision> => {
  const decision = DECISIONS.get(answer.trim().toLowerCase());
  return decision === undefined ? invalid('Answer y, n or e.\n') : valid(decision);
};

const labelsOf = (values: readonly StateValue[]): string => values.map((value) => value.label).join(', ');

const quoted = (labels: readonly string[]): string => labels.map((label) => `"${label}"`).join(', ');

const unknownValuesMessage = (field: StateField, unknown: readonly string[]): string =>
  `Unknown terminal value${unknown.length === 1 ? '' : 's'} ${quoted(unknown)} for ${field.name}; known values: ${labelsOf(field.values)}.\n`;

const noValueMessage = (field: StateField): string =>
  `No terminal value given for ${field.name}; type known values separated by commas, ${NO_TERMINAL_VALUES} for none, or press Enter to keep the suggestion.\n`;

const typedValues = (field: StateField, labels: readonly string[]): Interpretation<readonly StateValue[]> => {
  if (labels.length === 0) return invalid(noValueMessage(field));
  const unknown = [...new Set(labels.filter((label) => !field.values.some((value) => value.label === label)))];
  if (unknown.length > 0) return invalid(unknownValuesMessage(field, unknown));
  return valid(field.values.filter((value) => labels.includes(value.label)));
};

const valuesLabelled = (field: StateField, label: string): readonly StateValue[] =>
  field.values.filter((value) => value.label === label);

const interpretTerminalEntry = (suggestion: FieldSuggestion, entry: string): Interpretation<readonly StateValue[]> => {
  const trimmed = entry.trim();
  if (trimmed === '') return valid(suggestion.terminal);
  if (trimmed === NO_TERMINAL_VALUES) return valid([]);
  const labelled = valuesLabelled(suggestion.field, trimmed);
  if (labelled.length > 0) return valid(labelled);
  return typedValues(
    suggestion.field,
    trimmed
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label !== ''),
  );
};

const terminalLabels = (terminal: readonly StateValue[]): string => labelsOf(terminal) || 'none';

const declareQuestion = (suggestion: LifecycleSuggestion, root: string): string => {
  const fields = suggestion.fields.map((field) => `${field.field.name} [terminal: ${terminalLabels(field.terminal)}]`).join('; ');
  return `${suggestion.className} (${toPosixRelative(root, suggestion.file)}): ${fields}. Declare? [Y/n/e] `;
};

const currentTerminalLabels = (terminal: readonly StateValue[]): string => labelsOf(terminal) || NO_TERMINAL_VALUES;

const terminalQuestion = (suggestion: FieldSuggestion): string =>
  `${suggestion.field.name} terminal values [${currentTerminalLabels(suggestion.terminal)}] (known: ${labelsOf(suggestion.field.values)}; comma-separated, ${NO_TERMINAL_VALUES} for none, Enter to keep): `;

const askUntilValid = async <T>(io: Io, question: string, interpret: (answer: string) => Interpretation<T>): Promise<T> => {
  const interpretation = interpret(await io.prompt(question));
  if (interpretation.kind === 'valid') return interpretation.value;
  io.err(interpretation.message);
  return askUntilValid(io, question, interpret);
};

const editField = async (suggestion: FieldSuggestion, io: Io): Promise<FieldSuggestion> => ({
  ...suggestion,
  terminal: await askUntilValid(io, terminalQuestion(suggestion), (entry) => interpretTerminalEntry(suggestion, entry)),
});

const editSuggestion = async (suggestion: LifecycleSuggestion, io: Io): Promise<LifecycleSuggestion> => ({
  ...suggestion,
  fields: await suggestion.fields.reduce<Promise<readonly FieldSuggestion[]>>(
    async (edited, field) => [...(await edited), await editField(field, io)],
    Promise.resolve([]),
  ),
});

const reviewSuggestion = async (suggestion: LifecycleSuggestion, io: Io, root: string): Promise<readonly LifecycleSuggestion[]> => {
  const decision = await askUntilValid(io, declareQuestion(suggestion, root), interpretDecision);
  if (decision === 'skip') return [];
  if (decision === 'edit') return [await editSuggestion(suggestion, io)];
  return [suggestion];
};

export const reviewSuggestions = (suggestions: readonly LifecycleSuggestion[], io: Io, root: string): Promise<readonly LifecycleSuggestion[]> =>
  suggestions.reduce<Promise<readonly LifecycleSuggestion[]>>(
    async (accepted, suggestion) => [...(await accepted), ...(await reviewSuggestion(suggestion, io, root))],
    Promise.resolve([]),
  );
