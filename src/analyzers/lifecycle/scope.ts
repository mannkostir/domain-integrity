import { ClassDeclaration, SourceFile } from 'ts-morph';
import { AggregateScope } from './field-ref';
import { leaksThis } from './this-leak';

export const aggregateScope = (
  cls: ClassDeclaration,
  eventMethods: readonly string[],
  files: readonly SourceFile[],
): AggregateScope => ({
  cls,
  eventMethods: new Set(eventMethods),
  leaksThis: leaksThis(cls, files),
});
