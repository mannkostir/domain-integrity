import { Node } from 'ts-morph';
import { isDeclarationReference, refersTo } from './identity';
import { ScalarProjection, ScalarValue } from './model';
import { PredicateBudget } from './predicate-budget';
import { PredicateRead, unknownPredicate } from './predicate-model';

export const isProjectedRead = (node: Node, projection: ScalarProjection): boolean => {
  if (!Node.isPropertyAccessExpression(node) || node.hasQuestionDotToken()) return false;
  const record = node.getExpression();
  if (!Node.isPropertyAccessExpression(record) || record.hasQuestionDotToken() || !Node.isThisExpression(record.getExpression()) ||
      !refersTo(record.getNameNode(), projection.storage.holder)) return false;
  const actual = node.getNameNode().getSymbol()?.getDeclarations() ?? [];
  const expected = projection.storage.slot.getDeclarations();
  return actual.length === 1 && expected.length === 1 && actual[0] === expected[0];
};

export const predicateEnumLiteral = (
  node: Node, projection: ScalarProjection, budget: PredicateBudget, depth = 0,
): PredicateRead<ScalarValue> => {
  if (!budget.take(depth)) return unknownPredicate('predicate depth or work bound');
  if (Node.isParenthesizedExpression(node)) return predicateEnumLiteral(node.getExpression(), projection, budget, depth + 1);
  if (!Node.isPropertyAccessExpression(node) || node.hasQuestionDotToken() ||
      !isDeclarationReference(node.getExpression()) || !refersTo(node.getExpression(), projection.enumDeclaration)) {
    return unknownPredicate('not a pure reference to the projected enum');
  }
  const value = projection.values.find(value => refersTo(node.getNameNode(), value.member));
  return value === undefined ? unknownPredicate('not a literal member of the projected enum') : { kind: 'known', value };
};
