import { HeritageClause, Node, Type } from 'ts-morph';
import { someReachable } from '../reachable-types';

const MAX_HERITAGE_DEPTH = 8;

const heritageClausesOf = (declaration: Node): readonly HeritageClause[] =>
  Node.isClassDeclaration(declaration) || Node.isInterfaceDeclaration(declaration) ? declaration.getHeritageClauses() : [];

const heritageTypesOf = (type: Type): readonly Type[] =>
  (type.getSymbol()?.getDeclarations() ?? [])
    .flatMap(heritageClausesOf)
    .flatMap((clause) => clause.getTypeNodes())
    .map((heritage) => heritage.getType());

const extendsUnresolved = (type: Type, depth: number): boolean =>
  depth >= MAX_HERITAGE_DEPTH || heritageTypesOf(type).some((heritage) => heritage.isAny() || extendsUnresolved(heritage, depth + 1));

const isUnknown = (type: Type): boolean => type.isAny() || extendsUnresolved(type, 0);

export const hasUnknownType = (type: Type, location: Node): boolean => someReachable(type, location, isUnknown);
