import {
  ClassDeclaration,
  ClassExpression,
  ExpressionWithTypeArguments,
  Node,
  PropertyAccessExpression,
  SyntaxKind,
  ts,
  Type,
} from 'ts-morph';
import { hasUnknownClassDecorator } from '../shared/class-decorators';
import { outermostWrapper } from '../shared/wrappers';
import { SourceIndex } from '../shared/source-index';
import { isWritten, writesUnknownMembers } from '../shared/writes';
import { ProjectIndex } from './project-index';

type InertSources = Pick<ProjectIndex, 'sources' | 'bracketWrites'>;

const classLikes = (sources: SourceIndex): readonly (ClassDeclaration | ClassExpression)[] => [
  ...sources.ofKind(SyntaxKind.ClassDeclaration),
  ...sources.ofKind(SyntaxKind.ClassExpression),
];

const NON_STRING_KEY_FLAGS = ts.TypeFlags.NumberLike | ts.TypeFlags.ESSymbolLike;

const isOtherLiteral = (type: Type, name: string): boolean => type.isStringLiteral() && type.getLiteralValue() !== name;

const isNonStringKey = (type: Type): boolean => (type.getFlags() & NON_STRING_KEY_FLAGS) !== 0;

const isProvablyOtherKeyType = (type: Type, name: string): boolean => {
  if (type.isUnion()) return type.getUnionTypes().every((member) => isProvablyOtherKeyType(member, name));
  if (type.isTypeParameter()) {
    const constraint = type.getConstraint();
    return constraint !== undefined && isProvablyOtherKeyType(constraint, name);
  }
  return isOtherLiteral(type, name) || isNonStringKey(type);
};

const computedKeyOf = (member: Node): Node | undefined => {
  const nameNode = Node.isPropertyNamed(member) ? member.getNameNode() : undefined;
  return Node.isComputedPropertyName(nameNode) ? nameNode.getExpression() : undefined;
};

const hasComputedKeyFor = (member: Node, name: string): boolean => {
  const key = computedKeyOf(member);
  return key !== undefined && !isProvablyOtherKeyType(key.getType(), name);
};

const isNamed = (member: Node, name: string): boolean =>
  member.getSymbol()?.getName() === name ||
  (Node.hasName(member) && member.getName() === name) ||
  hasComputedKeyFor(member, name);

const isNonMethodMemberNamed =
  (name: string) =>
  (member: Node): boolean =>
    !Node.isMethodDeclaration(member) && isNamed(member, name);

const declaresNonMethodMember = (name: string, sources: SourceIndex): boolean =>
  classLikes(sources).some((classLike) => classLike.getInstanceMembers().some(isNonMethodMemberNamed(name)));

const isWrittenAccess = (access: PropertyAccessExpression): boolean => isWritten(outermostWrapper(access));

const isWrittenByName = (name: string, sources: SourceIndex): boolean => sources.propertyAccessesNamed(name).some(isWrittenAccess);

const isAssertable = (name: string, project: InertSources): boolean =>
  !declaresNonMethodMember(name, project.sources) &&
  !isWrittenByName(name, project.sources) &&
  project.bracketWrites.of(name).length === 0;

const installsUnknownMembers = (
  classes: readonly (ClassDeclaration | ClassExpression)[],
  inertDecorators: readonly string[],
): boolean => classes.some((cls) => hasUnknownClassDecorator(cls, inertDecorators)) || classes.some(writesUnknownMembers);

const extendsClausesOf = (declaration: Node): readonly ExpressionWithTypeArguments[] => {
  if (Node.isInterfaceDeclaration(declaration)) return declaration.getExtends();
  const heritage = Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration) ? declaration.getExtends() : undefined;
  return heritage === undefined ? [] : [heritage];
};

const isUnresolvedClause = (clause: ExpressionWithTypeArguments): boolean => clause.getExpression().getType().isAny();

const hasUnresolvedExtends = (declaration: Node): boolean => extendsClausesOf(declaration).some(isUnresolvedClause);

const declaresUnresolvedExtends = (type: Type): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some(hasUnresolvedExtends);

const hasUnresolvedHeritage = (type: Type, seen: ReadonlySet<ts.Type>): boolean => {
  const declared = type.getTargetType() ?? type;
  if (seen.has(declared.compilerType)) return false;
  const next = new Set([...seen, declared.compilerType]);
  return (
    declared.isAny() ||
    declaresUnresolvedExtends(declared) ||
    [...declared.getUnionTypes(), ...declared.getIntersectionTypes(), ...declared.getBaseTypes()].some((base) =>
      hasUnresolvedHeritage(base, next),
    )
  );
};

const hasResolvedBases = (cls: ClassDeclaration): boolean => !hasUnresolvedHeritage(cls.getType(), new Set());

export const assertedInertEventMethods = (
  names: readonly string[],
  cls: ClassDeclaration,
  family: readonly ClassDeclaration[],
  project: InertSources,
  inertDecorators: readonly string[],
): ReadonlySet<string> =>
  names.length === 0 ||
  !hasResolvedBases(cls) ||
  installsUnknownMembers([...family, ...project.sources.ofKind(SyntaxKind.ClassExpression)], inertDecorators)
    ? new Set()
    : new Set(names.filter((name) => isAssertable(name, project)));

export const isDeclaredOnlyAsMethods = (declarations: readonly Node[]): boolean =>
  declarations.length > 0 &&
  declarations.every((declaration) => Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration));
