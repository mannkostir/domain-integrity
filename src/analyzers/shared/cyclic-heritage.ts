import { ClassDeclaration } from 'ts-morph';
import { ancestry } from './ancestry';
import { classNamedBy } from './named-class';

const baseClassOf = (cls: ClassDeclaration): ClassDeclaration | undefined => cls.getBaseClass();

const namedBaseOf = (cls: ClassDeclaration): ClassDeclaration | undefined => {
  const heritage = cls.getExtends();
  return heritage === undefined ? undefined : classNamedBy(heritage.getExpression());
};

export const hasCyclicInheritance = (cls: ClassDeclaration): boolean =>
  ancestry(cls, baseClassOf).cyclic || ancestry(cls, namedBaseOf).cyclic;
