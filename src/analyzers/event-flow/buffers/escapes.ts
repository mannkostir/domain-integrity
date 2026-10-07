import { CallExpression, ElementAccessExpression, Expression, NewExpression, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../../shared/library';
import { unwrap } from '../../shared/wrappers';

type MayHold = (type: Type) => boolean;

const REFLECTIVE_OBJECT_METHODS: ReadonlySet<string> = new Set([
  'keys',
  'values',
  'entries',
  'assign',
  'getOwnPropertyNames',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
]);

const isReflectiveMember = (owner: string, member: string): boolean =>
  owner === 'Reflect' ||
  (owner === 'Object' && REFLECTIVE_OBJECT_METHODS.has(member)) ||
  (owner === 'JSON' && member === 'stringify');

const isReflectiveCallee = (callee: Node): boolean => {
  const target = unwrap(callee);
  if (Node.isIdentifier(target)) return target.getText() === 'structuredClone';
  if (!Node.isPropertyAccessExpression(target)) return false;
  return isReflectiveMember(unwrap(target.getExpression()).getText(), target.getName());
};

const anyArgumentHolds = (args: readonly Node[], mayHold: MayHold): boolean =>
  args.some((argument) => mayHold(argument.getType()));

const calleeDeclarations = (callee: Expression): readonly Node[] => {
  const symbol = callee.getSymbol();
  const resolved = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
  return resolved?.getDeclarations() ?? [];
};

const isForeignLibraryNode = (node: Node): boolean => isLibraryNode(node) && !isDefaultLibraryNode(node);

const isForeignCallee = (callee: Expression): boolean => {
  const declarations = calleeDeclarations(callee);
  return callee.getType().isAny() || declarations.length === 0 || declarations.every(isForeignLibraryNode);
};

const escapesThroughCall = (call: CallExpression, mayHold: MayHold): boolean =>
  anyArgumentHolds(call.getArguments(), mayHold) &&
  (isReflectiveCallee(call.getExpression()) || isForeignCallee(call.getExpression()));

const escapesThroughNew = (expression: NewExpression, mayHold: MayHold): boolean =>
  anyArgumentHolds(expression.getArguments() ?? [], mayHold) && isForeignCallee(expression.getExpression());

const isLiteralKey = (key: Node | undefined): boolean =>
  Node.isStringLiteral(key) || Node.isNumericLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key);

const escapesThroughComputedRead = (access: ElementAccessExpression, mayHold: MayHold): boolean =>
  !isLiteralKey(access.getArgumentExpression()) && mayHold(access.getExpression().getType());

const isOwnPrivateBufferSpread = (expression: Expression): boolean => {
  const target = unwrap(expression);
  return (
    Node.isPropertyAccessExpression(target) &&
    Node.isThisExpression(unwrap(target.getExpression())) &&
    (target.getSymbol()?.getDeclarations() ?? []).some(
      (declaration) => Node.isPropertyDeclaration(declaration) && declaration.hasModifier(SyntaxKind.PrivateKeyword),
    )
  );
};

const escapesThroughSpread = (expression: Expression, mayHold: MayHold): boolean =>
  !isOwnPrivateBufferSpread(expression) && mayHold(expression.getType());

const escapesIn = (file: SourceFile, mayHold: MayHold): boolean =>
  file.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => escapesThroughCall(call, mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.NewExpression).some((expression) => escapesThroughNew(expression, mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).some((access) => escapesThroughComputedRead(access, mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.SpreadAssignment).some((spread) => escapesThroughSpread(spread.getExpression(), mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.SpreadElement).some((spread) => escapesThroughSpread(spread.getExpression(), mayHold)) ||
  file.getDescendantsOfKind(SyntaxKind.ForInStatement).some((loop) => mayHold(loop.getExpression().getType()));

export const hasEscapeRoute = (production: readonly SourceFile[], mayHold: MayHold): boolean =>
  production.some((file) => escapesIn(file, mayHold));
