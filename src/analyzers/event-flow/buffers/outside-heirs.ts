import { ClassDeclaration, ClassExpression, Node, SourceFile, SyntaxKind, Type, ts } from 'ts-morph';

export type ProjectClass = ClassDeclaration | ClassExpression;

export const projectClassesIn = (files: readonly SourceFile[]): readonly ProjectClass[] =>
  files.flatMap((file) => [
    ...file.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...file.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ]);

const isFamilyType = (type: Type, family: ReadonlySet<Node>): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some((declaration) => family.has(declaration));

const baseTypesOf = (type: Type): readonly Type[] => {
  const target = type.getTargetType() ?? type;
  return target.isClassOrInterface() ? target.getBaseTypes() : [];
};

const reachesFamily = (type: Type, family: ReadonlySet<Node>, seen: ReadonlySet<ts.Type>): boolean => {
  if (seen.has(type.compilerType)) return false;
  const next: ReadonlySet<ts.Type> = new Set([...seen, type.compilerType]);
  return (
    isFamilyType(type, family) ||
    [...type.getIntersectionTypes(), ...type.getUnionTypes(), ...baseTypesOf(type)].some((inner) => reachesFamily(inner, family, next))
  );
};

const isOutsideHeir = (cls: ProjectClass, family: ReadonlySet<Node>): boolean => {
  const instance = cls.getSymbol()?.getDeclaredType();
  return !family.has(cls) && instance !== undefined && baseTypesOf(instance).some((base) => reachesFamily(base, family, new Set()));
};

export const hasHeirOutside = (family: readonly ClassDeclaration[], classes: readonly ProjectClass[]): boolean => {
  const members: ReadonlySet<Node> = new Set(family);
  return classes.some((cls) => isOutsideHeir(cls, members));
};
