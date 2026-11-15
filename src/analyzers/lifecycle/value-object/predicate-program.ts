import { Node, ParameterDeclaration, Statement, SwitchStatement, VariableDeclarationKind } from 'ts-morph';
import { enumDomain } from './enum-domain';
import { refersTo } from './identity';
import { ScalarProjection } from './model';
import { PredicateBudget } from './predicate-budget';
import { readPredicateExpression } from './predicate-expression';
import { PredicateExpression, PredicateProgram, PredicateRead, unknownPredicate } from './predicate-model';
import { isProjectedRead, predicateEnumLiteral } from './predicate-operands';

const returnExpression = (
  statements: readonly Statement[], projection: ScalarProjection, parameter: ParameterDeclaration | undefined, budget: PredicateBudget,
): PredicateRead<PredicateExpression> => {
  const [only] = statements;
  if (statements.length !== 1 || !Node.isReturnStatement(only)) return unknownPredicate('predicate path is not a single complete return');
  const expression = only.getExpression();
  return expression === undefined ? unknownPredicate('predicate return has no value') : readPredicateExpression(expression, projection, parameter, budget);
};

const readSwitch = (
  statement: SwitchStatement, projection: ScalarProjection, parameter: ParameterDeclaration | undefined, budget: PredicateBudget,
): PredicateRead<PredicateProgram> => {
  const cases: { readonly token: string; readonly expression: PredicateExpression }[] = [];
  const seen = new Set<string>();
  let pending: string[] = [];
  let pendingDefault = false;
  let fallback: PredicateExpression | undefined;
  for (const clause of statement.getClauses()) {
    if (!budget.take()) return unknownPredicate('predicate depth or work bound');
    if (Node.isCaseClause(clause)) {
      const label = predicateEnumLiteral(clause.getExpression(), projection, budget);
      if (label.kind === 'unknown') return label;
      if (seen.has(label.value.token)) return unknownPredicate('duplicate predicate switch label');
      seen.add(label.value.token);
      pending.push(label.value.token);
    } else {
      if (pendingDefault || fallback !== undefined) return unknownPredicate('duplicate predicate default');
      pendingDefault = true;
    }
    const statements = clause.getStatements();
    if (statements.length === 0) continue;
    const expression = returnExpression(statements, projection, parameter, budget);
    if (expression.kind === 'unknown') return expression;
    cases.push(...pending.map(token => ({ token, expression: expression.value })));
    if (pendingDefault) fallback = expression.value;
    pending = [];
    pendingDefault = false;
  }
  return fallback === undefined || pending.length > 0 || pendingDefault
    ? unknownPredicate('predicate switch has an incomplete return path')
    : { kind: 'known', value: { kind: 'switch', cases, fallback } };
};

export const readPredicateProgram = (
  statements: readonly Statement[], projection: ScalarProjection, parameter: ParameterDeclaration | undefined, budget: PredicateBudget,
): PredicateRead<PredicateProgram> => {
  if (statements.length === 1) {
    const expression = returnExpression(statements, projection, parameter, budget);
    return expression.kind === 'unknown' ? expression : { kind: 'known', value: { kind: 'return', expression: expression.value } };
  }
  const [binding, selection] = statements;
  if (statements.length !== 2 || !Node.isVariableStatement(binding) || !Node.isSwitchStatement(selection) ||
      binding.getDeclarationKind() !== VariableDeclarationKind.Const || binding.getDeclarations().length !== 1) {
    return unknownPredicate('not a single return or immutable snapshot switch');
  }
  const [snapshot] = binding.getDeclarations();
  const initializer = snapshot?.getInitializer();
  if (snapshot === undefined || !Node.isIdentifier(snapshot.getNameNode()) || initializer === undefined ||
      !isProjectedRead(initializer, projection) || enumDomain(snapshot.getType())?.declaration !== projection.enumDeclaration) {
    return unknownPredicate('snapshot does not bind the proven scalar receiver');
  }
  const discriminant = selection.getExpression();
  if (!Node.isIdentifier(discriminant) || !refersTo(discriminant, snapshot)) return unknownPredicate('switch does not read the immutable snapshot');
  return readSwitch(selection, projection, parameter, budget);
};
