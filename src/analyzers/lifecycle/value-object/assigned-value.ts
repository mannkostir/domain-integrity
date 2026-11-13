import { Expression, Node, ParameterDeclaration, SyntaxKind } from 'ts-morph';
import { literalToken } from '../../../engine/value-token';
import { unwrap } from '../../shared/wrappers';
import { isLibraryNode } from '../../shared/library';
import { MAX_PROJECTION_DEPTH, ProjectedValue, ScalarProjection } from './model';
import { isDeclarationReference, referencedClass, resolvedSymbol, simpleParameter } from './identity';

type Bindings = ReadonlyMap<ParameterDeclaration, ProjectedValue>;
const unresolved = (reason: string): ProjectedValue => ({ kind: 'unresolved', reason });

const scalarValue = (expression: Node, projection: ScalarProjection, bindings: Bindings): ProjectedValue => {
  const node = unwrap(expression);
  if (Node.isIdentifier(node)) {
    const bound = [...bindings].find(([parameter]) => parameter.getSymbol() === resolvedSymbol(node));
    if (bound !== undefined) return bound[1];
  }
  const member = Node.isPropertyAccessExpression(node) && !node.hasQuestionDotToken()
    ? projection.enumDeclaration.getMembers().find(candidate => candidate.getSymbol() === resolvedSymbol(node.getNameNode()))
    : undefined;
  const literal = Node.isStringLiteral(node) || Node.isNumericLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ||
    (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken && Node.isNumericLiteral(node.getOperand()));
  if (!literal && member === undefined) return unresolved('argument is not a proven scalar literal');
  if (member !== undefined && (!Node.isPropertyAccessExpression(node) || !isDeclarationReference(node.getExpression()) ||
      resolvedSymbol(node.getExpression()) !== projection.enumDeclaration.getSymbol())) {
    return unresolved('unproved enum receiver');
  }
  const token = literalToken(node.getType());
  return token !== undefined && projection.values.some(value => value.token === token)
    ? { kind: 'known', token } : unresolved('argument is outside the scalar domain');
};

const sameParameterArgument = (node: Node, parameter: ParameterDeclaration): boolean =>
  Node.isIdentifier(unwrap(node)) && resolvedSymbol(unwrap(node)) === parameter.getSymbol();

const mapValue = (expression: Node, projection: ScalarProjection, bindings: Bindings, visited: ReadonlySet<Node>): ProjectedValue => {
  if (visited.size >= MAX_PROJECTION_DEPTH || visited.has(expression)) return unresolved('factory recursion bound');
  const node = unwrap(expression);
  if (Node.isNewExpression(node)) {
    const [argument] = node.getArguments();
    return referencedClass(node.getExpression()) === projection.wrapper && node.getArguments().length === 1 && argument !== undefined
      ? scalarValue(argument, projection, bindings) : unresolved('unproved wrapper construction');
  }
  if (!Node.isCallExpression(node) || node.hasQuestionDotToken()) return unresolved('not a direct constructor or factory call');
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.hasQuestionDotToken() || referencedClass(callee.getExpression()) !== projection.wrapper) {
    return unresolved('unproved factory receiver');
  }
  const declarations = resolvedSymbol(callee.getNameNode())?.getDeclarations() ?? [];
  const [method] = declarations;
  if (declarations.length !== 1 || !Node.isMethodDeclaration(method) || !method.isStatic() ||
      method.getParent() !== projection.wrapper || isLibraryNode(method) || method.getDecorators().length > 0 ||
      method.isAsync() || method.isGenerator() || method.getOverloads().length > 0) return unresolved('unproved factory implementation');
  const parameter = simpleParameter(method.getParameters());
  const body = method.getBody();
  const statements = Node.isBlock(body) ? body.getStatements() : [];
  const [only] = statements;
  const [argument] = node.getArguments();
  if (parameter === undefined || statements.length !== 1 || !Node.isReturnStatement(only) ||
      node.getArguments().length !== 1 || argument === undefined) return unresolved('unproved factory forwarding');
  const returned = only.getExpression();
  const forwarded = returned === undefined ? undefined : unwrap(returned);
  if ((!Node.isNewExpression(forwarded) && !Node.isCallExpression(forwarded)) || forwarded.getArguments().length !== 1 ||
      !sameParameterArgument(forwarded.getArguments()[0]!, parameter)) return unresolved('factory does not forward its scalar parameter');
  const next = new Set([...visited, expression]);
  return mapValue(forwarded, projection, new Map([[parameter, scalarValue(argument, projection, bindings)]]), next);
};

export const mapProjectedValue = (expression: Expression, projection: ScalarProjection): ProjectedValue =>
  mapValue(expression, projection, new Map(), new Set());
