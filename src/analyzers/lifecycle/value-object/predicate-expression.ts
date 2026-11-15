import { Node, ParameterDeclaration, SyntaxKind } from 'ts-morph';
import { isDefaultLibraryNode } from '../../shared/library';
import { refersTo, resolvedSymbol } from './identity';
import { ScalarProjection } from './model';
import { PredicateBudget } from './predicate-budget';
import { PredicateExpression, PredicateRead, unknownPredicate } from './predicate-model';
import { isProjectedRead, predicateEnumLiteral } from './predicate-operands';

export const readPredicateExpression = (
  node: Node, projection: ScalarProjection, parameter: ParameterDeclaration | undefined, budget: PredicateBudget, depth = 0,
): PredicateRead<PredicateExpression> => {
  if (!budget.take(depth)) return unknownPredicate('predicate depth or work bound');
  if (Node.isParenthesizedExpression(node)) return readPredicateExpression(node.getExpression(), projection, parameter, budget, depth + 1);
  if (node.getKind() === SyntaxKind.TrueKeyword || node.getKind() === SyntaxKind.FalseKeyword) {
    return { kind: 'known', value: { kind: 'boolean', value: node.getKind() === SyntaxKind.TrueKeyword } };
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsEqualsEqualsToken) {
    const left = node.getLeft();
    const right = node.getRight();
    const other = isProjectedRead(left, projection) ? right : isProjectedRead(right, projection) ? left : undefined;
    if (other === undefined) return unknownPredicate('comparison does not read the proven scalar receiver');
    const literal = predicateEnumLiteral(other, projection, budget, depth + 1);
    return literal.kind === 'unknown' ? literal : { kind: 'known', value: { kind: 'equals', token: literal.value.token } };
  }
  if (!Node.isCallExpression(node) || node.hasQuestionDotToken() || node.getTypeArguments().length > 0) {
    return unknownPredicate('unsupported predicate expression');
  }
  const member = node.getExpression();
  if (!Node.isPropertyAccessExpression(member) || member.hasQuestionDotToken() || member.getName() !== 'includes') {
    return unknownPredicate('not a literal-array includes expression');
  }
  const declarations = resolvedSymbol(member.getNameNode())?.getDeclarations() ?? [];
  const array = member.getExpression();
  const [argument] = node.getArguments();
  if (declarations.length === 0 || !declarations.every(isDefaultLibraryNode) || !Node.isArrayLiteralExpression(array) ||
      parameter === undefined || node.getArguments().length !== 1 || !Node.isIdentifier(argument) || !refersTo(argument, parameter)) {
    return unknownPredicate('includes operands or implementation are unproved');
  }
  const tokens: string[] = [];
  for (const element of array.getElements()) {
    const read = predicateEnumLiteral(element, projection, budget, depth + 1);
    if (read.kind === 'unknown') return read;
    tokens.push(read.value.token);
  }
  return { kind: 'known', value: { kind: 'includes', tokens } };
};
