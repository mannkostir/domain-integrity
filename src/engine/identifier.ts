import { ts } from 'ts-morph';

const codePoints = (text: string): readonly number[] => Array.from(text, (character) => character.codePointAt(0) ?? Number.NaN);

export const isIdentifierText = (name: string): boolean => {
  const [first, ...rest] = codePoints(name);
  return (
    first !== undefined &&
    ts.isIdentifierStart(first, ts.ScriptTarget.Latest) &&
    rest.every((codePoint) => ts.isIdentifierPart(codePoint, ts.ScriptTarget.Latest))
  );
};
