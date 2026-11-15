import { Expression, MethodDeclaration, Node } from 'ts-morph';
import { isLibraryNode } from '../../shared/library';
import { enumDomain } from './enum-domain';
import { simpleParameter } from './identity';
import { ScalarProjection, ScalarValue } from './model';
import { PredicateBudget } from './predicate-budget';
import { MAX_PREDICATE_WORK, PredicateExpression, PredicateProof, PredicateRead, PredicateSources, WrapperPredicate, unknownPredicate } from './predicate-model';
import { predicateEnumLiteral } from './predicate-operands';
import { readPredicateProgram } from './predicate-program';

export const proveWrapperPredicate = (method: MethodDeclaration, projection: ScalarProjection): PredicateProof => {
  if (method.getParent() !== projection.wrapper || isLibraryNode(method) || method.isStatic() || method.isAsync() || method.isGenerator() ||
      method.getOverloads().length > 0 || method.getDecorators().length > 0 || method.getTypeParameters().length > 0 ||
      !Node.isIdentifier(method.getNameNode())) return unknownPredicate('unproved wrapper predicate implementation');
  const declarations = projection.wrapper.getType().getProperty(method.getName())?.getDeclarations() ?? [];
  if (declarations.length !== 1 || declarations[0] !== method) return unknownPredicate('unproved wrapper predicate member identity');
  const parameters = method.getParameters();
  const parameter = simpleParameter(parameters);
  if (parameters.length > 0 && (parameter === undefined || enumDomain(parameter.getType())?.declaration !== projection.enumDeclaration)) {
    return unknownPredicate('unproved scalar predicate parameter');
  }
  const returnType = method.getReturnType();
  const body = method.getBody();
  if ((!returnType.isBoolean() && !returnType.isBooleanLiteral()) || !Node.isBlock(body)) return unknownPredicate('predicate has no concrete boolean body');
  if (projection.values.length > MAX_PREDICATE_WORK || new Set(projection.values.map(value => value.token)).size !== projection.values.length) {
    return unknownPredicate('predicate scalar domain exceeds bounds or has ambiguous tokens');
  }
  const program = readPredicateProgram(body.getStatements(), projection, parameter, new PredicateBudget());
  return program.kind === 'unknown' ? program : {
    kind: 'proven',
    predicate: { scope: 'local-wrapper-predicate-body', requires: projection.requires, projection, method, parameter, program: program.value },
  };
};

const boundArgument = (predicate: WrapperPredicate, arguments_: readonly Expression[]): PredicateRead<string | undefined> => {
  if (predicate.parameter === undefined) return arguments_.length === 0
    ? { kind: 'known', value: undefined } : unknownPredicate('unexpected predicate arguments');
  const [argument] = arguments_;
  if (arguments_.length !== 1 || argument === undefined) return unknownPredicate('predicate requires one known enum literal argument');
  const value = predicateEnumLiteral(argument, predicate.projection, new PredicateBudget());
  return value.kind === 'unknown' ? value : { kind: 'known', value: value.value.token };
};

const evaluateExpression = (expression: PredicateExpression, current: string, target: string | undefined): boolean => {
  if (expression.kind === 'boolean') return expression.value;
  if (expression.kind === 'equals') return current === expression.token;
  return target !== undefined && expression.tokens.includes(target);
};

export const evaluateWrapperPredicate = (
  predicate: WrapperPredicate, current: ScalarValue, arguments_: readonly Expression[],
): PredicateRead<boolean> => {
  if (!predicate.projection.values.some(value => value.member === current.member && value.token === current.token)) {
    return unknownPredicate('current scalar does not belong to the proven enum domain');
  }
  const argument = boundArgument(predicate, arguments_);
  if (argument.kind === 'unknown') return argument;
  const program = predicate.program;
  const expression = program.kind === 'return' ? program.expression : program.cases.find(entry => entry.token === current.token)?.expression ?? program.fallback;
  return { kind: 'known', value: evaluateExpression(expression, current.token, argument.value) };
};

export const wrapperPredicateSources = (predicate: WrapperPredicate, arguments_: readonly Expression[]): PredicateSources => {
  const whenTrue = new Set<string>();
  const whenFalse = new Set<string>();
  for (const current of predicate.projection.values) {
    const result = evaluateWrapperPredicate(predicate, current, arguments_);
    if (result.kind === 'unknown') return result;
    (result.value ? whenTrue : whenFalse).add(current.token);
  }
  return { kind: 'known', whenTrue, whenFalse };
};
