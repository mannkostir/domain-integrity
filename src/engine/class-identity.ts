import { ClassDeclaration } from 'ts-morph';
import { toPosixRelative } from './path';

export type ClassIdentity = { readonly id: string; readonly name: string; readonly qualifiedName: string };

export const className = (cls: ClassDeclaration): string => cls.getName() ?? '<anonymous>';

const sharedNames = (classes: readonly ClassDeclaration[]): ReadonlySet<string> => {
  const names = classes.map(className);
  return new Set(names.filter((name, index) => names.indexOf(name) !== index));
};

export const classIdentities = (
  classes: readonly ClassDeclaration[],
  root: string,
): ReadonlyMap<ClassDeclaration, ClassIdentity> => {
  const shared = sharedNames(classes);
  return new Map(
    classes.map((cls) => {
      const name = className(cls);
      const qualifiedName = `${toPosixRelative(root, cls.getSourceFile().getFilePath())}:${name}`;
      return [cls, { id: shared.has(name) ? qualifiedName : name, name, qualifiedName }];
    }),
  );
};
