import { CallExpression, ClassDeclaration, Expression, NewExpression, Node, SyntaxKind, ts, Type } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from './library';
import { namedClassChain } from './named-chain';
import { isTransparentConstruction } from './transparent-constructor';
import { outermostWrapper, unwrap } from './wrappers';

const MAX_GETTER_DEPTH = 5;

const isThis = (node: Node): boolean => {
  const target = unwrap(node);
  return Node.isThisExpression(target) || Node.isSuperExpression(target);
};

const stringKey = (node: Node): string | undefined =>
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : undefined;

const memberName = (node: Node): string | undefined => {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;
  const argument = node.getArgumentExpression();
  return argument === undefined ? undefined : stringKey(argument);
};

const isThisProps = (node: Node): boolean =>
  (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) &&
  memberName(node) === 'props' &&
  isThis(node.getExpression());

const isStateHolder = (node: Node): boolean => {
  const target = unwrap(node);
  return Node.isThisExpression(target) || isThisProps(target);
};

export const fieldNameOf = (node: Node): string | undefined =>
  (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) &&
  isStateHolder(node.getExpression())
    ? memberName(node)
    : undefined;

const STATE_HOLDER = 'props';

export type AggregateScope = {
  readonly cls: ClassDeclaration;
  readonly eventMethods: ReadonlySet<string>;
  readonly inertMembers: ReadonlySet<string>;
  readonly leaksThis: boolean;
};

type MemberLookup =
  | { readonly kind: 'inert' }
  | { readonly kind: 'data'; readonly declarations: readonly Node[]; readonly initializer?: Node }
  | { readonly kind: 'body'; readonly body: Node }
  | { readonly kind: 'untraceable' };

export const inheritanceChain = (cls: ClassDeclaration): readonly ClassDeclaration[] => {
  const base = cls.getBaseClass();
  return base === undefined ? [cls] : [cls, ...inheritanceChain(base)];
};

const isSuperAccess = (node: Node): boolean =>
  (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) &&
  Node.isSuperExpression(unwrap(node.getExpression()));

const superChain = (access: Node): readonly ClassDeclaration[] => {
  const declaring = access.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  return declaring === undefined ? [] : inheritanceChain(declaring).slice(1);
};

const lookupChain = (cls: ClassDeclaration, access: Node): readonly ClassDeclaration[] =>
  isSuperAccess(access) ? superChain(access) : inheritanceChain(cls);

const isDataDeclaration = (node: Node): boolean =>
  (Node.isPropertyDeclaration(node) && node.getInitializer() === undefined) ||
  Node.isPropertySignature(node) ||
  Node.isParameterDeclaration(node);

const bodyOf = (member: Node): MemberLookup => {
  if (Node.isPropertyDeclaration(member)) {
    const initializer = member.getInitializer();
    return { kind: 'data', declarations: [member], initializer };
  }
  if (Node.isMethodDeclaration(member) || Node.isGetAccessorDeclaration(member)) {
    const body = member.getBody();
    return body === undefined ? { kind: 'untraceable' } : { kind: 'body', body };
  }
  return { kind: 'untraceable' };
};

const declaredMember = (chain: readonly ClassDeclaration[], name: string): Node | undefined =>
  chain
    .map((candidate) => candidate.getGetAccessor(name) ?? candidate.getMethod(name) ?? candidate.getProperty(name))
    .find((found) => found !== undefined);

const typedMember = (cls: ClassDeclaration, name: string): MemberLookup => {
  const declarations = cls.getType().getProperty(name)?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDataDeclaration) ? { kind: 'data', declarations } : { kind: 'untraceable' };
};

const bindsThis = (node: Node): boolean =>
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isConstructorDeclaration(node) ||
  Node.isGetAccessorDeclaration(node) ||
  Node.isSetAccessorDeclaration(node) ||
  Node.isPropertyDeclaration(node);

export const hasForeignThis = (access: Node): boolean => {
  const binder = access.getFirstAncestor(bindsThis);
  return Node.isFunctionExpression(binder) || Node.isFunctionDeclaration(binder);
};

const absentMember = (cls: ClassDeclaration, access: Node, name: string): MemberLookup =>
  hasForeignThis(access) ? { kind: 'inert' } : typedMember(cls, name);

const tracedMember = (cls: ClassDeclaration, access: Node, name: string): MemberLookup => {
  const member = declaredMember(lookupChain(cls, access), name);
  return member === undefined ? absentMember(cls, access, name) : bodyOf(member);
};

const isUninitialisedLibraryData = (member: MemberLookup): boolean =>
  member.kind === 'data' && member.initializer === undefined && member.declarations.every(isLibraryNode);

const declarationsAcrossHierarchy = (type: Type, name: string): readonly Node[] => [
  ...(type.getProperty(name)?.getDeclarations() ?? []),
  ...type.getBaseTypes().flatMap((base) => declarationsAcrossHierarchy(base, name)),
];

const isDeclaredOnlyInLibraries = (cls: ClassDeclaration, name: string): boolean =>
  declarationsAcrossHierarchy(cls.getType(), name).every(isLibraryNode);

const isListedLibraryMember = (scope: AggregateScope, name: string): boolean =>
  scope.inertMembers.has(name) && isDeclaredOnlyInLibraries(scope.cls, name);

const isInertEventMethod = (scope: AggregateScope, name: string, member: MemberLookup): boolean =>
  member.kind === 'untraceable' && scope.eventMethods.has(name);

const isInertUntraceable = (scope: AggregateScope, name: string, member: MemberLookup): boolean =>
  member.kind === 'untraceable' && isListedLibraryMember(scope, name);

const isInertLibraryData = (scope: AggregateScope, name: string, member: MemberLookup): boolean =>
  isUninitialisedLibraryData(member) && isListedLibraryMember(scope, name);

const isAssumedInert = (scope: AggregateScope, name: string, member: MemberLookup): boolean =>
  isInertEventMethod(scope, name, member) ||
  isInertUntraceable(scope, name, member) ||
  isInertLibraryData(scope, name, member);

const lookupMember = (scope: AggregateScope, access: Node, name: string): MemberLookup => {
  const member = tracedMember(scope.cls, access, name);
  return isAssumedInert(scope, name, member) ? { kind: 'inert' } : member;
};

const exposesField = (type: Type, field: string, location: Node): boolean =>
  type.getProperty(field) !== undefined ||
  type.getProperty(STATE_HOLDER)?.getTypeAtLocation(location).getProperty(field) !== undefined;

const canCarryField = (type: Type, field: string, cls: ClassDeclaration): boolean =>
  type.isAny() ||
  type.isUnknown() ||
  (type.isUnion() && type.getUnionTypes().some((member) => canCarryField(member, field, cls))) ||
  cls.getType().isAssignableTo(type) ||
  exposesField(type, field, cls) ||
  type.getStringIndexType() !== undefined;

const MAX_CALLABLE_DEPTH = 3;

const hasIndexSignature = (type: Type): boolean =>
  type.isObject() &&
  !type.isArray() &&
  !type.isTuple() &&
  (type.getStringIndexType() !== undefined || type.getNumberIndexType() !== undefined);

const memberTypes = (type: Type, location: Node): readonly Type[] => {
  if (type.isUnion()) return type.getUnionTypes();
  if (type.isTuple()) return type.getTupleElements();
  const element = type.getArrayElementType();
  if (element !== undefined) return [element];
  return type.isObject()
    ? type.getProperties().map((property) => property.getTypeAtLocation(location))
    : [];
};

const containsCallable = (type: Type, location: Node, depth = 0): boolean =>
  type.getCallSignatures().length > 0 ||
  hasIndexSignature(type) ||
  (depth < MAX_CALLABLE_DEPTH &&
    memberTypes(type, location).some((member) => containsCallable(member, location, depth + 1)));

const isOverwritten = (access: Node): boolean => {
  const target = outermostWrapper(access);
  const parent = target.getParent();
  return (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    parent.getLeft() === target
  );
};

const libraryDataReadsField = (access: Node, field: string, cls: ClassDeclaration): boolean => {
  const type = access.getType();
  return containsCallable(type, access) || canCarryField(type, field, cls);
};

const PRIMITIVE_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void;

const isDefaultLibraryType = (type: Type): boolean => {
  const declarations = type.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
};

const isPrimitiveType = (type: Type, depth = 0): boolean =>
  (type.getFlags() & PRIMITIVE_FLAGS) !== 0 ||
  (depth < MAX_CALLABLE_DEPTH &&
    ((type.isUnion() && type.getUnionTypes().every((member) => isPrimitiveType(member, depth + 1))) ||
      (isDefaultLibraryType(type) &&
        type.getCallSignatures().length === 0 &&
        !hasIndexSignature(type) &&
        [...type.getTypeArguments(), ...type.getAliasTypeArguments()].every((argument) =>
          isPrimitiveType(argument, depth + 1),
        ))));

const projectDataReadsField = (access: Node, scope: AggregateScope): boolean =>
  scope.leaksThis && !isPrimitiveType(access.getType());

const dataReadsField = (access: Node, declarations: readonly Node[], field: string, scope: AggregateScope): boolean => {
  if (isOverwritten(access)) return false;
  return declarations.some(isLibraryNode)
    ? libraryDataReadsField(access, field, scope.cls)
    : projectDataReadsField(access, scope);
};

const findGetter = (cls: ClassDeclaration, access: Node, name: string) =>
  lookupChain(cls, access)
    .map((candidate) => candidate.getGetAccessor(name))
    .find((accessor) => accessor !== undefined);

const thisMemberName = (node: Node): string | undefined =>
  (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) && isThis(node.getExpression())
    ? memberName(node)
    : undefined;

export const thisGetterExpression = (node: Node, cls: ClassDeclaration): Expression | undefined => {
  const name = thisMemberName(node);
  if (name === undefined) return undefined;
  const body = findGetter(cls, node, name)?.getBody();
  if (!Node.isBlock(body)) return undefined;
  const statements = body.getStatements();
  const [only] = statements;
  return statements.length === 1 && Node.isReturnStatement(only) ? only.getExpression() : undefined;
};

export const isReceiverOfAccess = (node: Node): boolean => {
  const parent = node.getParent();
  return (
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    parent.getExpression() === node
  );
};

export const escapesStateHolder = (node: Node): boolean =>
  (Node.isThisExpression(node) || isThisProps(node)) && !isReceiverOfAccess(outermostWrapper(node));

const argumentOwner = (node: Node): Node | undefined => {
  const holder = outermostWrapper(node);
  const parent = holder.getParent();
  return (Node.isNewExpression(parent) || Node.isCallExpression(parent)) && parent.getArguments().includes(holder)
    ? parent
    : undefined;
};

const reachesLibraryBaseByName = (cls: ClassDeclaration): boolean => {
  const chain = namedClassChain(cls);
  const last = chain?.[chain.length - 1];
  return last !== undefined && isLibraryNode(last);
};

const isTrustedEventCall = (call: CallExpression, scope: AggregateScope): boolean => {
  const callee = unwrap(call.getExpression());
  return (
    Node.isPropertyAccessExpression(callee) &&
    isThis(callee.getExpression()) &&
    scope.eventMethods.has(callee.getName()) &&
    reachesLibraryBaseByName(scope.cls) &&
    isDeclaredOnlyInLibraries(scope.cls, callee.getName()) &&
    lookupMember(scope, callee, callee.getName()).kind === 'inert'
  );
};

const isEventHandoff = (construction: NewExpression, scope: AggregateScope): boolean => {
  const call = argumentOwner(construction);
  return Node.isCallExpression(call) && isTrustedEventCall(call, scope) && isTransparentConstruction(construction);
};

const isHandedToEventMethod = (node: Node, scope: AggregateScope): boolean => {
  const construction = Node.isThisExpression(node) ? argumentOwner(node) : undefined;
  return Node.isNewExpression(construction) && isEventHandoff(construction, scope);
};

const escapesIntoUnknown = (node: Node, scope: AggregateScope): boolean =>
  escapesStateHolder(node) && !isHandedToEventMethod(node, scope);

const readsWithComputedKey = (node: Node): boolean =>
  Node.isElementAccessExpression(node) && isStateHolder(node.getExpression()) && memberName(node) === undefined;

const readsThroughMember = (node: Node, field: string, scope: AggregateScope, depth: number): boolean => {
  const name = thisMemberName(node);
  if (name === undefined || name === STATE_HOLDER || name === field) return false;
  const member = lookupMember(scope, node, name);
  if (member.kind === 'inert') return false;
  if (member.kind === 'data') {
    return (
      dataReadsField(node, member.declarations, field, scope) ||
      (member.initializer !== undefined &&
        !isOverwritten(node) &&
        (depth >= MAX_GETTER_DEPTH || referencesField(member.initializer, field, scope, depth + 1)))
    );
  }
  if (member.kind === 'untraceable') return true;
  return depth >= MAX_GETTER_DEPTH || referencesField(member.body, field, scope, depth + 1);
};

export const referencesFieldDirectly = (node: Node, field: string, scope: AggregateScope, depth = 0): boolean =>
  fieldNameOf(node) === field ||
  escapesIntoUnknown(node, scope) ||
  readsWithComputedKey(node) ||
  readsThroughMember(node, field, scope, depth);

export const referencesField = (node: Node, field: string, scope: AggregateScope, depth = 0): boolean =>
  [node, ...node.getDescendants()].some((candidate) => referencesFieldDirectly(candidate, field, scope, depth));

export const isRootedAtThis = (node: Node): boolean => {
  if (Node.isThisExpression(node)) return true;
  if (
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node) ||
    Node.isParenthesizedExpression(node) ||
    Node.isNonNullExpression(node)
  ) {
    return isRootedAtThis(node.getExpression());
  }
  return false;
};
