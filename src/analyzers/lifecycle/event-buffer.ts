import {
  CallExpression,
  ClassDeclaration,
  Node,
  PropertyAccessExpression,
  PropertyDeclaration,
  SyntaxKind,
  Type,
  ts,
  VariableDeclarationKind,
} from 'ts-morph';
import { isBracketWrittenIn, isPlainArrayPush, isPlainDeclaration, isPushOnlyMethod, isResetToEmpty } from '../shared/array-store';
import { hasUnknownClassDecorator } from '../shared/class-decorators';
import { BracketWrites, accessOf, isAssignOntoThis, isComputedWriteOnThis } from '../shared/writes';
import { outermostWrapper, unwrap } from '../shared/wrappers';

const isZero = (node: Node | undefined): boolean => {
  const target = node === undefined ? undefined : unwrap(node);
  return Node.isNumericLiteral(target) && target.getLiteralValue() === 0;
};

const isReturned = (node: Node): boolean => {
  const outer = outermostWrapper(node);
  const statement = outer.getParent();
  return Node.isReturnStatement(statement) && statement.getExpression() === outer;
};

const isReturnedConst = (node: Node): boolean => {
  const outer = outermostWrapper(node);
  const declaration = outer.getParent();
  if (!Node.isVariableDeclaration(declaration) || declaration.getInitializer() !== outer) return false;
  const name = declaration.getNameNode();
  if (!Node.isIdentifier(name)) return false;
  if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return false;
  const uses = name.findReferencesAsNodes().filter((reference) => reference !== name);
  return uses.length > 0 && uses.every(isReturned);
};

const isHandedOut = (node: Node): boolean => isReturned(node) || isReturnedConst(node);

const isCopiedOut = (target: Node): boolean => {
  const spread = target.getParent();
  const literal = spread?.getParent();
  return (
    Node.isSpreadElement(spread) &&
    Node.isArrayLiteralExpression(literal) &&
    literal.getElements().length === 1 &&
    isHandedOut(literal)
  );
};

const memberOf = (target: Node, name: string): PropertyAccessExpression | undefined => {
  const member = target.getParent();
  return Node.isPropertyAccessExpression(member) &&
    member.getExpression() === target &&
    member.getName() === name &&
    !member.hasQuestionDotToken()
    ? member
    : undefined;
};

const isLengthReset = (target: Node): boolean => {
  const length = memberOf(target, 'length');
  if (length === undefined) return false;
  const outer = outermostWrapper(length);
  const assignment = outer.getParent();
  return (
    Node.isBinaryExpression(assignment) &&
    assignment.getLeft() === outer &&
    assignment.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    isZero(assignment.getRight())
  );
};

const isSpliceReset = (target: Node): boolean => {
  const splice = memberOf(target, 'splice');
  const call = splice?.getParent();
  if (!Node.isCallExpression(call) || call.getExpression() !== splice || call.hasQuestionDotToken()) return false;
  const [start, ...rest] = call.getArguments();
  return rest.length === 0 && isZero(start) && (Node.isExpressionStatement(outermostWrapper(call).getParent()) || isHandedOut(call));
};

export const isEventBufferReset = (target: Node): boolean =>
  isResetToEmpty(target) || isLengthReset(target) || isSpliceReset(target);

const declarationsAreIn = (node: Node, buffers: ReadonlySet<Node>): boolean => {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every((declaration) => buffers.has(declaration));
};

export const isEventBufferAccess = (node: Node, buffers: ReadonlySet<Node>): boolean =>
  Node.isPropertyAccessExpression(node) &&
  Node.isThisExpression(unwrap(node.getExpression())) &&
  declarationsAreIn(node, buffers);

const pushCallOf = (access: Node): CallExpression | undefined => {
  const call = outermostWrapper(access).getParent()?.getParent();
  return Node.isCallExpression(call) ? call : undefined;
};

const isInPushOnlyEventMethod = (access: Node, candidates: ReadonlySet<Node>, eventMethods: ReadonlySet<string>): boolean => {
  const method = access.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  return method !== undefined && eventMethods.has(method.getName()) && isPushOnlyMethod(method, candidates);
};

const pushesOnlyNewObjects = (call: CallExpression): boolean => {
  const values = call.getArguments();
  return values.length > 0 && values.every((value) => Node.isNewExpression(unwrap(value)));
};

const isEventPush = (access: Node, candidates: ReadonlySet<Node>, eventMethods: ReadonlySet<string>): boolean => {
  if (!isPlainArrayPush(access, candidates)) return false;
  const call = pushCallOf(access);
  return call !== undefined && (pushesOnlyNewObjects(call) || isInPushOnlyEventMethod(access, candidates, eventMethods));
};

const isBufferUse = (reference: Node, candidates: ReadonlySet<Node>, eventMethods: ReadonlySet<string>): boolean => {
  const access = accessOf(reference);
  if (!Node.isPropertyAccessExpression(access) || !Node.isThisExpression(unwrap(access.getExpression()))) return false;
  const target = outermostWrapper(access);
  return isEventBufferReset(target) || isEventPush(access, candidates, eventMethods) || isHandedOut(target) || isCopiedOut(target);
};

const partsOf = (type: Type): readonly Type[] =>
  type.isUnion() ? type.getUnionTypes() : type.isIntersection() ? type.getIntersectionTypes() : [type];

const isGenericOrMapped = (type: Type): boolean =>
  (type.getFlags() & ts.TypeFlags.Instantiable) !== 0 || (type.getObjectFlags() & ts.ObjectFlags.Mapped) !== 0;

const canCarry = (type: Type, name: string): boolean =>
  partsOf(type).some((part) =>
    part === type
      ? part.isAny() ||
        part.isUnknown() ||
        isGenericOrMapped(part) ||
        part.getStringIndexType() !== undefined ||
        part.getNumberIndexType() !== undefined ||
        part.getProperty(name) !== undefined
      : canCarry(part, name),
  );

const assignCanReach = (call: CallExpression, name: string): boolean =>
  call
    .getArguments()
    .slice(1)
    .some((source) => Node.isSpreadElement(source) || canCarry(source.getType(), name));

const isReachedByAssign = (property: PropertyDeclaration, family: readonly ClassDeclaration[]): boolean =>
  family.some((cls) =>
    cls
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(isAssignOntoThis)
      .some((call) => assignCanReach(call, property.getName())),
  );

const writesComputedKeys = (cls: ClassDeclaration): boolean =>
  cls.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).some(isComputedWriteOnThis);

const referencesOf = (property: PropertyDeclaration): readonly Node[] =>
  property.findReferencesAsNodes().filter((reference) => reference !== property.getNameNode());

export const eventBuffers = (
  family: readonly ClassDeclaration[],
  writes: BracketWrites,
  inertDecorators: readonly string[],
  eventMethods: ReadonlySet<string>,
): ReadonlySet<Node> => {
  if (family.some((cls) => hasUnknownClassDecorator(cls, inertDecorators) || writesComputedKeys(cls))) return new Set();
  const candidates = family
    .flatMap((cls) => cls.getProperties())
    .filter((property) => isPlainDeclaration(property) && !isBracketWrittenIn(property, writes) && !isReachedByAssign(property, family));
  const candidateSet: ReadonlySet<Node> = new Set(candidates);
  return new Set(candidates.filter((property) => referencesOf(property).every((reference) => isBufferUse(reference, candidateSet, eventMethods))));
};
