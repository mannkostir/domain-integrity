import { Finding } from '../../../analyzer';
import { AggregateModel, FieldDeclaration, MethodModel, StateField } from '../model';
import { fieldOf, quoted } from './format';

const leakFinding = (
  aggregate: AggregateModel,
  field: StateField,
  method: MethodModel,
  leaked: readonly string[],
): Finding => ({
  checkId: 'terminal-state-leak',
  severity: 'error',
  aggregate: aggregate.name,
  method: method.name,
  field: field.name,
  subject: leaked.join(','),
  file: method.file,
  line: method.line,
  message: `${method.name}() can run after ${field.name} is ${quoted(field, leaked)}.`,
  fix: `Guard ${method.name}() so it cannot run when ${field.name} is ${quoted(field, leaked)}, or list it in allowAfterTerminal if that is intended.`,
});

export const leakedTerminalTokens = (
  aggregate: AggregateModel,
  method: MethodModel,
  field: StateField,
  terminal: ReadonlySet<string>,
): string[] => {
  const sources = method.fields.get(field.name)?.sources;
  const judged = method.visibility === 'public' && method.mutates && !aggregate.allowAfterTerminal.has(method.name);
  if (!judged || sources?.kind !== 'known') return [];
  return field.values.map((value) => value.token).filter((token) => terminal.has(token) && sources.values.has(token));
};

const leaksOf = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): Finding[] =>
  aggregate.methods.flatMap((method) => {
    const leaked = leakedTerminalTokens(aggregate, method, field, declaration.terminal);
    return leaked.length === 0 ? [] : [leakFinding(aggregate, field, method, leaked)];
  });

export const terminalStateLeak = (aggregate: AggregateModel): Finding[] =>
  [...aggregate.declarations].flatMap(([name, declaration]) =>
    leaksOf(aggregate, fieldOf(aggregate, name), declaration),
  );
