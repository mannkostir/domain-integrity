import { Type } from 'ts-morph';

export const SET = 'set';
export const UNSET = 'unset';

export const literalToken = (type: Type): string | undefined => {
  if (type.isBooleanLiteral()) return type.getText();
  const value = type.getLiteralValue();
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

export const isNullish = (type: Type): boolean => type.isNull() || type.isUndefined();
