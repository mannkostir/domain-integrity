import { BinaryExpression, Block, Node, Statement, SyntaxKind } from 'ts-morph';
import { AssignedValueResolver, TrackedAssignmentTarget, assignedValue } from './assigned';
import { fieldNameOf } from './field-ref';
import { StateField, WrittenAlongside } from './model';
import { unwrap } from '../shared/wrappers';

const NOTHING: ReadonlySet<string> = new Set();

const INTERRUPTIONS: readonly SyntaxKind[] = [
  SyntaxKind.ReturnStatement,
  SyntaxKind.ThrowStatement,
  SyntaxKind.BreakStatement,
  SyntaxKind.ContinueStatement,
  SyntaxKind.AwaitExpression,
  SyntaxKind.YieldExpression,
  SyntaxKind.CallExpression,
  SyntaxKind.NewExpression,
  SyntaxKind.TaggedTemplateExpression,
];

const isPlainWriteTo = (binary: BinaryExpression, field: StateField): boolean =>
  binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken && fieldNameOf(unwrap(binary.getLeft())) === field.name;

const writeSites = (scope: Node, field: StateField, tracksTarget?: TrackedAssignmentTarget): readonly BinaryExpression[] =>
  scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((binary) => isPlainWriteTo(binary, field) && tracksTarget?.(binary.getLeft(), field) !== false);

const tokensWrittenBy = (statement: Statement, field: StateField, resolver?: AssignedValueResolver, tracksTarget?: TrackedAssignmentTarget): ReadonlySet<string> => {
  if (!Node.isExpressionStatement(statement)) return NOTHING;
  const expression = statement.getExpression();
  if (!Node.isBinaryExpression(expression) || !isPlainWriteTo(expression, field) || tracksTarget?.(expression.getLeft(), field) === false) return NOTHING;
  const value = assignedValue(expression.getRight(), field, resolver);
  return value.unresolved ? NOTHING : value.tokens;
};

const interrupts = (node: Node): boolean =>
  INTERRUPTIONS.includes(node.getKind()) || (Node.isForOfStatement(node) && node.isAwaited());

const mayLeave = (statement: Statement): boolean => [statement, ...statement.getDescendants()].some(interrupts);

const enclosingBlocks = (statement: Statement): readonly Block[] => {
  const ancestors = statement.getAncestors();
  const boundary = ancestors.findIndex(Node.isFunctionLikeDeclaration);
  return ancestors.slice(0, boundary === -1 ? ancestors.length : boundary).filter(Node.isBlock);
};

const runsWith = (statements: readonly Statement[], site: number, position: number, write: Statement): boolean => {
  const between = statements.slice(statements[site] === write ? site + 1 : site, position);
  return position < site || (position > site && !between.some(mayLeave));
};

const tokensWrittenAround = (block: Block, statement: Statement, field: StateField, resolver?: AssignedValueResolver, tracksTarget?: TrackedAssignmentTarget): readonly string[] => {
  const statements = block.getStatements();
  const lineage: readonly Node[] = [statement, ...statement.getAncestors()];
  const site = statements.findIndex((candidate) => lineage.includes(candidate));
  return statements.flatMap((candidate, position) =>
    runsWith(statements, site, position, statement) ? [...tokensWrittenBy(candidate, field, resolver, tracksTarget)] : [],
  );
};

const tokensAlwaysWrittenWith = (write: BinaryExpression, field: StateField, resolver?: AssignedValueResolver, tracksTarget?: TrackedAssignmentTarget): ReadonlySet<string> => {
  const statement = write.getParent();
  if (!Node.isExpressionStatement(statement)) return NOTHING;
  return new Set(enclosingBlocks(statement).flatMap((block) => tokensWrittenAround(block, statement, field, resolver, tracksTarget)));
};

const intersection = (sets: readonly ReadonlySet<string>[]): ReadonlySet<string> =>
  sets.reduce((common, next) => new Set([...common].filter((token) => next.has(token))));

const alongsideWrites = (
  writes: readonly BinaryExpression[],
  others: readonly StateField[],
  resolver?: AssignedValueResolver,
  tracksTarget?: TrackedAssignmentTarget,
): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map(
    others
      .map((other): [string, ReadonlySet<string>] => [
        other.name,
        intersection(writes.map((write) => tokensAlwaysWrittenWith(write, other, resolver, tracksTarget))),
      ])
      .filter(([, tokens]) => tokens.size > 0),
  );

export const writtenAlongside = (scope: Node, fields: readonly StateField[], resolver?: AssignedValueResolver, tracksTarget?: TrackedAssignmentTarget): WrittenAlongside =>
  new Map(
    fields.flatMap((field): [string, ReadonlyMap<string, ReadonlySet<string>>][] => {
      const writes = writeSites(scope, field, tracksTarget);
      return writes.length === 0 ? [] : [[field.name, alongsideWrites(writes, fields.filter((other) => other !== field), resolver, tracksTarget)]];
    }),
  );
