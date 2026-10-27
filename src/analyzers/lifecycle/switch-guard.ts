import { CaseOrDefaultClause, Expression, Node, Statement, SwitchStatement } from 'ts-morph';
import { ExitKind, branchStatements, isEarlyExit, containsReturnOrThrow } from './early-exit';
import { AggregateScope, fieldNameOf, referencesField } from './field-ref';
import { strictTokens } from './guard-condition';
import { guardUniverse } from './guard-tokens';
import { StateField } from './model';
import { difference, union } from './values';

export type SwitchGroup = {
  readonly kind: 'exit' | 'pass' | 'work';
  readonly tokens: ReadonlySet<string>;
  readonly work: readonly Statement[];
};

export type FieldSwitch = { readonly groups: readonly SwitchGroup[]; readonly recognised: readonly Node[] };

type LabelTokens = ReadonlySet<string> | 'default';

type ClauseRun = { readonly tokens: ReadonlySet<string>; readonly statements: readonly Statement[] };

type Classified = Omit<SwitchGroup, 'tokens'> | 'unknown';

export const isFieldSwitch = (statement: Statement, field: StateField): statement is SwitchStatement =>
  Node.isSwitchStatement(statement) && fieldNameOf(statement.getExpression()) === field.name;

const caseLabelTokens = (label: Expression, field: StateField, scope: AggregateScope): ReadonlySet<string> | undefined =>
  referencesField(label, field.name, scope) ? undefined : strictTokens(label, field);

const clauseLabelTokens = (clause: CaseOrDefaultClause, field: StateField, scope: AggregateScope): LabelTokens | undefined =>
  Node.isCaseClause(clause) ? caseLabelTokens(clause.getExpression(), field, scope) : 'default';

const resolveLabels = (
  clauses: readonly CaseOrDefaultClause[],
  field: StateField,
  scope: AggregateScope,
): readonly ClauseRun[] | 'unknown' => {
  const labelled = clauses.flatMap((clause) => {
    const label = clauseLabelTokens(clause, field, scope);
    return label === undefined ? [] : [{ label, statements: clause.getStatements() }];
  });
  if (labelled.length !== clauses.length) return 'unknown';
  const matched = labelled.reduce<ReadonlySet<string>>(
    (all, { label }) => (label === 'default' ? all : union(all, label)),
    new Set(),
  );
  const unmatched = difference(guardUniverse(field), matched);
  return labelled.map(({ label, statements }) => ({ tokens: label === 'default' ? unmatched : label, statements }));
};

const mergeFallthrough = (clauses: readonly ClauseRun[]): readonly ClauseRun[] => {
  const merged = clauses.reduce<{ readonly runs: readonly ClauseRun[]; readonly pending: ReadonlySet<string> | undefined }>(
    ({ runs, pending }, clause) => {
      const tokens = union(pending ?? new Set<string>(), clause.tokens);
      return clause.statements.length === 0
        ? { runs, pending: tokens }
        : { runs: [...runs, { tokens, statements: clause.statements }], pending: undefined };
    },
    { runs: [], pending: undefined },
  );
  return merged.pending === undefined ? merged.runs : [...merged.runs, { tokens: merged.pending, statements: [] }];
};

const firstMatchWins = (runs: readonly ClauseRun[]): readonly ClauseRun[] =>
  runs.reduce<{ readonly claimed: ReadonlySet<string>; readonly runs: readonly ClauseRun[] }>(
    ({ claimed, runs: kept }, run) => ({
      claimed: union(claimed, run.tokens),
      runs: [...kept, { ...run, tokens: difference(run.tokens, claimed) }],
    }),
    { claimed: new Set(), runs: [] },
  ).runs;

const clauseBody = (statements: readonly Statement[]): readonly Statement[] => {
  const [only] = statements;
  return statements.length === 1 && only !== undefined ? branchStatements(only) : statements;
};

const isPlainBreak = (statement: Statement | undefined): boolean =>
  Node.isBreakStatement(statement) && statement.getLabel() === undefined;

const isLabelledJump = (node: Node): boolean =>
  (Node.isBreakStatement(node) || Node.isContinueStatement(node)) && node.getLabel() !== undefined;

const leavesGroup = (statement: Statement): boolean =>
  containsReturnOrThrow(statement) || [statement, ...statement.getDescendants()].some(isLabelledJump);

const classify = (statements: readonly Statement[], last: boolean, exits: ExitKind): Classified => {
  const body = clauseBody(statements);
  if (isEarlyExit(body, exits)) return { kind: 'exit', work: [] };
  const endsInBreak = isPlainBreak(body.at(-1));
  if (!endsInBreak && !last) return 'unknown';
  const work = endsInBreak ? body.slice(0, -1) : body;
  if (work.length === 0) return { kind: 'pass', work };
  return work.some(isPlainBreak) || work.some(leavesGroup) ? 'unknown' : { kind: 'work', work };
};

const classifyRuns = (runs: readonly ClauseRun[], exits: ExitKind): readonly SwitchGroup[] | 'unknown' => {
  const groups = runs.map((run, index) => {
    const classified = classify(run.statements, index === runs.length - 1, exits);
    return classified === 'unknown' ? classified : { ...classified, tokens: run.tokens };
  });
  return groups.every((group): group is SwitchGroup => group !== 'unknown') ? groups : 'unknown';
};

export const readFieldSwitch = (
  statement: SwitchStatement,
  field: StateField,
  scope: AggregateScope,
  exits: ExitKind,
): FieldSwitch | 'unknown' => {
  const clauses = statement.getCaseBlock().getClauses();
  const labelled = resolveLabels(clauses, field, scope);
  if (labelled === 'unknown') return 'unknown';
  const groups = classifyRuns(firstMatchWins(mergeFallthrough(labelled)), exits);
  if (groups === 'unknown') return 'unknown';
  const caseLabels = clauses.flatMap((clause) => (Node.isCaseClause(clause) ? [clause.getExpression()] : []));
  return { groups, recognised: [statement.getExpression(), ...caseLabels] };
};
