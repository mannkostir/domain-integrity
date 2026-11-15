import { ClassDeclaration, Expression, Node, ParameterDeclaration, SyntaxKind } from 'ts-morph';
import { literalToken } from '../../../engine/value-token';
import { unwrap } from '../../shared/wrappers';
import { isLibraryNode } from '../../shared/library';
import { MAX_PROJECTION_DEPTH, ProjectedValue, ScalarProjection } from './model';
import { isDeclarationReference, referencedClass, resolvedSymbol, simpleParameter } from './identity';

const unresolved = (reason: string): ProjectedValue => ({ kind: 'unresolved', reason });

const scalarValue = (expression: Node, projection: ScalarProjection): ProjectedValue => {
  const node = unwrap(expression);
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

type ConstructionProof = { readonly kind: 'proven'; readonly dependencies: readonly Node[] } |
  { readonly kind: 'unknown'; readonly reason: string };
type ConstructionTrace = { readonly kind: 'proven'; readonly dependencies: readonly Node[]; readonly argument: Node } |
  { readonly kind: 'unknown'; readonly reason: string };
const unknown = (reason: string): ConstructionTrace => ({ kind: 'unknown', reason });

const constructorDependencies = (projection: ScalarProjection): readonly Node[] => {
  const dependencies: Node[] = [];
  const classes = new Set<ClassDeclaration>();
  let current: ClassDeclaration | undefined = projection.wrapper;
  while (current !== undefined && !classes.has(current) && classes.size < MAX_PROJECTION_DEPTH) {
    classes.add(current);
    dependencies.push(current);
    for (const constructor of current.getConstructors()) {
      dependencies.push(constructor);
      const body = constructor.getBody();
      if (body !== undefined) dependencies.push(body);
    }
    const base = current.getExtends();
    current = base === undefined ? undefined : referencedClass(base.getExpression());
  }
  return dependencies;
};

const traceConstruction = (expression: Node, projection: ScalarProjection, visited: ReadonlySet<Node>): ConstructionTrace => {
  if (visited.size >= MAX_PROJECTION_DEPTH || visited.has(expression)) return unknown('factory recursion bound');
  const node = unwrap(expression);
  if (Node.isNewExpression(node)) {
    const [argument] = node.getArguments();
    return referencedClass(node.getExpression()) === projection.wrapper && node.getArguments().length === 1 && argument !== undefined && !Node.isSpreadElement(argument)
      ? { kind: 'proven', argument, dependencies: constructorDependencies(projection) } : unknown('unproved wrapper construction');
  }
  if (!Node.isCallExpression(node) || node.hasQuestionDotToken()) return unknown('not a direct constructor or factory call');
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.hasQuestionDotToken() || referencedClass(callee.getExpression()) !== projection.wrapper) {
    return unknown('unproved factory receiver');
  }
  const declarations = resolvedSymbol(callee.getNameNode())?.getDeclarations() ?? [];
  const [method] = declarations;
  if (declarations.length !== 1 || !Node.isMethodDeclaration(method) || !method.isStatic() ||
      method.getParent() !== projection.wrapper || isLibraryNode(method) || method.getDecorators().length > 0 ||
      method.isAsync() || method.isGenerator() || method.getOverloads().length > 0) return unknown('unproved factory implementation');
  const parameter = simpleParameter(method.getParameters());
  const body = method.getBody();
  const statements = Node.isBlock(body) ? body.getStatements() : [];
  const [only] = statements;
  const [argument] = node.getArguments();
  if (parameter === undefined || statements.length !== 1 || !Node.isReturnStatement(only) ||
      node.getArguments().length !== 1 || argument === undefined || Node.isSpreadElement(argument)) return unknown('unproved factory forwarding');
  const returned = only.getExpression();
  const forwarded = returned === undefined ? undefined : unwrap(returned);
  if ((!Node.isNewExpression(forwarded) && !Node.isCallExpression(forwarded)) || forwarded.getArguments().length !== 1 ||
      !sameParameterArgument(forwarded.getArguments()[0]!, parameter)) return unknown('factory does not forward its scalar parameter');
  const next = new Set([...visited, expression]);
  const trace = traceConstruction(forwarded, projection, next);
  return trace.kind === 'unknown' ? trace : { kind: 'proven', argument, dependencies: [method, ...trace.dependencies] };
};

export const proveProjectedConstruction = (expression: Expression, projection: ScalarProjection): ConstructionProof => {
  const trace = traceConstruction(expression, projection, new Set());
  return trace.kind === 'unknown' ? trace : { kind: 'proven', dependencies: trace.dependencies };
};

export const mapProjectedValue = (expression: Expression, projection: ScalarProjection): ProjectedValue => {
  const trace = traceConstruction(expression, projection, new Set());
  return trace.kind === 'unknown' ? unresolved(trace.reason) : scalarValue(trace.argument, projection);
};
