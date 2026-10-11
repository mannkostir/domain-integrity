import { Type } from 'ts-morph';

export const areComparable = (first: Type, second: Type): boolean => first.isAssignableTo(second) || second.isAssignableTo(first);
