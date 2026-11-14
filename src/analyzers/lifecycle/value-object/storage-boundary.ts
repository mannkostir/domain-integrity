import { ClassDeclaration, Expression, Node, SyntaxKind } from 'ts-morph';
import { unwrap } from '../../shared/wrappers';
import { referencedClass, resolvedSymbol, simpleParameter } from './identity';
import { MAX_PROJECTION_DEPTH } from './model';

const inertInitializer = (node: Node): boolean =>
  Node.isStringLiteral(node) || Node.isNumericLiteral(node) || Node.isTrueLiteral(node) || Node.isFalseLiteral(node) ||
  Node.isNullLiteral(node) || (Node.isArrayLiteralExpression(node) && node.getElements().length === 0);

export const storesRecord = (cls: ClassDeclaration, visited = new Set<ClassDeclaration>()): boolean => {
  if (visited.has(cls) || visited.size >= MAX_PROJECTION_DEPTH || cls.getSourceFile().isDeclarationFile() || cls.getDecorators().length > 0) return false;
  if (cls.getMembers().some(member => Node.isClassStaticBlockDeclaration(member) ||
      ('getDecorators' in member && member.getDecorators().length > 0) ||
      ('getParameters' in member && member.getParameters().some(parameter => parameter.getDecorators().length > 0)) ||
      (Node.isPropertyDeclaration(member) && member.getInitializer() !== undefined && !inertInitializer(member.getInitializerOrThrow())))) return false;
  const base = cls.getExtends() === undefined ? undefined : referencedClass(cls.getExtends()!.getExpression());
  if (cls.getExtends() !== undefined && base === undefined) return false;
  const constructors = cls.getConstructors();
  const next = new Set([...visited, cls]);
  if (constructors.length === 0) return base !== undefined && storesRecord(base, next);
  const constructor = constructors[0]!;
  const parameter = simpleParameter(constructor.getParameters());
  const body = constructor.getBody();
  if (constructors.length !== 1 || constructor.getOverloads().length > 0 || parameter === undefined || !Node.isBlock(body)) return false;
  const statements = body.getStatements();
  const only = statements[0];
  if (statements.length !== 1 || !Node.isExpressionStatement(only)) return false;
  const expression = unwrap(only.getExpression());
  if (base !== undefined) {
    return Node.isCallExpression(expression) && expression.getExpression().getKind() === SyntaxKind.SuperKeyword &&
      expression.getArguments().length === 1 && resolvedSymbol(unwrap(expression.getArguments()[0]!)) === parameter.getSymbol() && storesRecord(base, next);
  }
  if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
  const left = unwrap(expression.getLeft());
  return Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) && left.getName() === 'props' &&
    (left.getNameNode().getSymbol()?.getDeclarations() ?? []).some(Node.isPropertyDeclaration) &&
    Node.isIdentifier(unwrap(expression.getRight())) && resolvedSymbol(unwrap(expression.getRight())) === parameter.getSymbol();
};

export const acceptsRecord = (expression: Expression, aggregates: readonly ClassDeclaration[], visited = new Set<Node>()): boolean => {
  if (visited.has(expression) || visited.size >= MAX_PROJECTION_DEPTH) return false;
  const node = unwrap(expression);
  if (Node.isNewExpression(node)) {
    const cls = referencedClass(node.getExpression());
    return cls !== undefined && aggregates.includes(cls) && node.getArguments().length === 1 && storesRecord(cls);
  }
  if (!Node.isCallExpression(node) || node.hasQuestionDotToken() || node.getArguments().length !== 1) return false;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.hasQuestionDotToken()) return false;
  const cls = referencedClass(callee.getExpression());
  if (cls === undefined || !aggregates.includes(cls)) return false;
  const declarations = callee.getNameNode().getSymbol()?.getDeclarations() ?? [];
  const method = declarations[0];
  if (declarations.length !== 1 || !Node.isMethodDeclaration(method) || method.getParent() !== cls || !method.isStatic() ||
      method.isAsync() || method.isGenerator() || method.getDecorators().length > 0 || method.getOverloads().length > 0) return false;
  const parameter = simpleParameter(method.getParameters());
  const body = method.getBody();
  const statements = Node.isBlock(body) ? body.getStatements() : [];
  const only = statements[0];
  if (parameter === undefined || statements.length !== 1 || !Node.isReturnStatement(only)) return false;
  const returned = only.getExpression();
  const forwarded = returned === undefined ? undefined : unwrap(returned);
  return (Node.isCallExpression(forwarded) || Node.isNewExpression(forwarded)) && forwarded.getArguments().length === 1 &&
    Node.isIdentifier(unwrap(forwarded.getArguments()[0]!)) && resolvedSymbol(unwrap(forwarded.getArguments()[0]!)) === parameter.getSymbol() &&
    acceptsRecord(forwarded, aggregates, new Set([...visited, expression]));
};
