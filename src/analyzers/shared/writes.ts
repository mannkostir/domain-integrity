import { CallExpression, ClassDeclaration, ClassExpression, ElementAccessExpression, Node, SyntaxKind, Type } from 'ts-morph';
import { SourceIndex } from './source-index';
import { outermostWrapper, unwrap } from './wrappers';

const isAssignmentOperator = (kind: SyntaxKind): boolean =>
  kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;

const isDestructuringPart = (node: Node): boolean =>
  Node.isArrayLiteralExpression(node) ||
  Node.isObjectLiteralExpression(node) ||
  Node.isPropertyAssignment(node) ||
  Node.isShorthandPropertyAssignment(node) ||
  Node.isSpreadElement(node) ||
  Node.isSpreadAssignment(node) ||
  Node.isParenthesizedExpression(node);

export const destructuringRoot = (node: Node): Node => {
  const parent = node.getParent();
  return parent !== undefined && isDestructuringPart(parent) ? destructuringRoot(parent) : node;
};

const UPDATE_OPERATORS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

const isUpdated = (parent: Node | undefined): boolean =>
  (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
  UPDATE_OPERATORS.has(parent.getOperatorToken());

export const isWritten = (target: Node): boolean => {
  const root = destructuringRoot(target);
  const parent = root.getParent();
  if (Node.isBinaryExpression(parent)) {
    return parent.getLeft() === root && isAssignmentOperator(parent.getOperatorToken().getKind());
  }
  if (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) return parent.getInitializer() === root;
  return isUpdated(parent) || Node.isDeleteExpression(parent);
};

export const accessOf = (reference: Node): Node | undefined => {
  const parent = reference.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference) return parent;
  if (Node.isElementAccessExpression(parent) && parent.getArgumentExpression() === reference) return parent;
  return undefined;
};

const literalKeyText = (key: Node | undefined): string | undefined =>
  Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key) ? key.getLiteralText() : undefined;

const stringLiteralValues = (type: Type): readonly string[] => {
  const value = type.getLiteralValue();
  return type.isStringLiteral() && typeof value === 'string' ? [value] : [];
};

const keyTypeNames = (key: Node): readonly string[] => {
  const type = key.getType();
  return [...stringLiteralValues(type), ...type.getUnionTypes().flatMap(stringLiteralValues)];
};

export const keyNames = (key: Node | undefined): readonly string[] => {
  if (key === undefined) return [];
  const literal = literalKeyText(unwrap(key));
  return literal !== undefined ? [literal] : [...new Set(keyTypeNames(key))];
};

export const isKeyFor = (key: Node | undefined, name: string): boolean => keyNames(key).includes(name);

const isAssignKey = (key: Node | undefined): boolean => isKeyFor(key, 'assign');

const isAssignAccess = (callee: Node): boolean =>
  (Node.isIdentifier(callee) && callee.getText() === 'assign') ||
  (Node.isPropertyAccessExpression(callee) && callee.getName() === 'assign') ||
  (Node.isElementAccessExpression(callee) && isAssignKey(callee.getArgumentExpression()));

const isAssignProperty = (name: Node): boolean =>
  Node.isIdentifier(name) ? name.getText() === 'assign' :
    isAssignKey(Node.isComputedPropertyName(name) ? name.getExpression() : name);

type ArgumentPrefix = { readonly values: readonly Node[]; readonly uncertain: boolean };
type AssignmentReference = { readonly bound: ArgumentPrefix };
export type MemberAssignment = { readonly target: Node | undefined; readonly sources: readonly Node[] };

const invocationOf = (node: Node): { readonly receiver: Node; readonly name: string } | undefined => {
  const access = unwrap(node);
  const names = Node.isPropertyAccessExpression(access) ? [access.getName()] :
    Node.isElementAccessExpression(access) ? keyNames(access.getArgumentExpression()) : [];
  const name = names.length === 1 ? names[0] : undefined;
  return (name === 'call' || name === 'apply' || name === 'bind') &&
    (Node.isPropertyAccessExpression(access) || Node.isElementAccessExpression(access)) ? { receiver: access.getExpression(), name } : undefined;
};

const expandedArguments = (args: readonly Node[]): ArgumentPrefix => {
  const values: Node[] = [];
  for (const argument of args) {
    if (!Node.isSpreadElement(argument)) { values.push(argument); continue; }
    const spread = unwrap(argument.getExpression());
    if (!Node.isArrayLiteralExpression(spread)) return { values, uncertain: true };
    const expanded = expandedArguments(spread.getElements());
    values.push(...expanded.values);
    if (expanded.uncertain) return { values, uncertain: true };
  }
  return { values, uncertain: false };
};

const assignmentReference = (node: Node, seen: ReadonlySet<Node>): AssignmentReference | undefined => {
  const target = unwrap(node);
  if (isAssignAccess(target)) return { bound: { values: [], uncertain: false } };
  if (Node.isCallExpression(target)) {
    const invocation = invocationOf(target.getExpression());
    if (invocation?.name !== 'bind') return undefined;
    const reference = assignmentReference(invocation.receiver, seen);
    if (reference === undefined) return undefined;
    const bound = expandedArguments(target.getArguments().slice(1));
    return { bound: reference.bound.uncertain ? reference.bound :
      { values: [...reference.bound.values, ...bound.values], uncertain: bound.uncertain } };
  }
  const symbol = target.getSymbol();
  const resolved = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  for (const declaration of resolved?.getDeclarations() ?? []) {
    if (seen.has(declaration)) continue;
    if (Node.isBindingElement(declaration) && isAssignProperty(declaration.getPropertyNameNode() ?? declaration.getNameNode())) return { bound: { values: [], uncertain: false } };
    const initializer = Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration) ||
      Node.isPropertyDeclaration(declaration) || Node.isParameterDeclaration(declaration) ? declaration.getInitializer() : undefined;
    if (initializer === undefined) continue;
    const reference = assignmentReference(initializer, new Set([...seen, declaration]));
    if (reference !== undefined) return reference;
  }
  return undefined;
};

export const memberAssignments = (call: CallExpression): readonly MemberAssignment[] => {
  const invocation = invocationOf(call.getExpression());
  if (invocation?.name === 'bind') return [];
  const reference = assignmentReference(invocation?.receiver ?? call.getExpression(), new Set());
  if (reference === undefined) return [];
  const args = call.getArguments();
  const list = invocation?.name === 'apply' ? args[1] : undefined;
  const supplied = invocation?.name === 'apply'
    ? Node.isArrayLiteralExpression(list) ? expandedArguments(list.getElements()) : { values: [], uncertain: true }
    : expandedArguments(invocation?.name === 'call' ? args.slice(1) : args);
  const argsPrefix = reference.bound.uncertain ? reference.bound :
    { values: [...reference.bound.values, ...supplied.values], uncertain: supplied.uncertain };
  const sources = [...argsPrefix.values.slice(1), ...(argsPrefix.uncertain ? [call] : [])];
  return argsPrefix.values.length === 0 && !argsPrefix.uncertain ? [] : [{ target: argsPrefix.values[0], sources }];
};

export const isAssignOntoThis = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const [target] = node.getArguments();
  return isAssignAccess(unwrap(node.getExpression())) && target !== undefined && Node.isThisExpression(unwrap(target));
};

const isLiteralKey = (key: Node | undefined): boolean =>
  Node.isStringLiteral(key) || Node.isNumericLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key);

export const isComputedWriteOnThis = (node: Node): boolean =>
  Node.isElementAccessExpression(node) &&
  Node.isThisExpression(unwrap(node.getExpression())) &&
  !isLiteralKey(node.getArgumentExpression()) &&
  isWritten(outermostWrapper(node));

export const writesUnknownMembers = (cls: ClassDeclaration | ClassExpression): boolean =>
  cls.getDescendantsOfKind(SyntaxKind.CallExpression).some(isAssignOntoThis) ||
  cls.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).some(isComputedWriteOnThis);

const writtenBracketAccess =
  (name: string) =>
  (access: ElementAccessExpression): readonly Node[] => {
    const target = outermostWrapper(access);
    return isWritten(target) && isKeyFor(access.getArgumentExpression(), name) ? [target] : [];
  };

export class BracketWrites {
  private writtenAccesses: readonly ElementAccessExpression[] | undefined;
  private readonly byName = new Map<string, readonly Node[]>();

  constructor(private readonly sources: SourceIndex) {}

  of(name: string): readonly Node[] {
    const known = this.byName.get(name);
    if (known !== undefined) return known;
    const writes = this.written().flatMap(writtenBracketAccess(name));
    this.byName.set(name, writes);
    return writes;
  }

  private written(): readonly ElementAccessExpression[] {
    this.writtenAccesses ??= this.sources
      .ofKind(SyntaxKind.ElementAccessExpression)
      .filter((access) => isWritten(outermostWrapper(access)));
    return this.writtenAccesses;
  }
}
