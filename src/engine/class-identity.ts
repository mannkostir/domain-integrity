import { ClassDeclaration } from 'ts-morph';
import { toPosixRelative } from './path';

export type ClassIdentity = { readonly id: string; readonly name: string; readonly qualifiedName: string };

export const className = (cls: ClassDeclaration): string => cls.getName() ?? '<anonymous>';

export const classIdentity = (cls: ClassDeclaration, root: string): ClassIdentity => {
  const name = className(cls);
  const qualifiedName = `${toPosixRelative(root, cls.getSourceFile().getFilePath())}:${name}`;
  return { id: qualifiedName, name, qualifiedName };
};

export const classIdentities = (
  classes: readonly ClassDeclaration[],
  root: string,
): ReadonlyMap<ClassDeclaration, ClassIdentity> => new Map(classes.map((cls) => [cls, classIdentity(cls, root)]));
