import { ClassDeclaration, SourceFile, SyntaxKind } from 'ts-morph';

export const aggregateName = (cls: ClassDeclaration): string => cls.getName() ?? '<anonymous>';

const extendsNamed = (cls: ClassDeclaration, names: ReadonlySet<string>, seen: ReadonlySet<ClassDeclaration>): boolean => {
  const heritage = cls.getExtends();
  if (!heritage || seen.has(cls)) return false;
  const baseName = heritage.getExpression().getText().split('.').pop() ?? '';
  if (names.has(baseName)) return true;
  const base = cls.getBaseClass();
  return base !== undefined && extendsNamed(base, names, new Set([...seen, cls]));
};

export const discoverAggregates = (
  files: readonly SourceFile[],
  baseClasses: readonly string[],
  declared: readonly ClassDeclaration[],
): ClassDeclaration[] => {
  const names = new Set(baseClasses);
  const discovered = files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((cls) => !cls.isAbstract() && extendsNamed(cls, names, new Set()));
  return [...new Set([...declared, ...discovered])];
};
