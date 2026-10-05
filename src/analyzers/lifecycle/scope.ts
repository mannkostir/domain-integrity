import { ClassDeclaration, SourceFile } from 'ts-morph';
import { DomainDeclaration } from '../../engine/declaration';
import { AggregateScope } from './field-ref';
import { leaksThis } from './this-leak';

export const aggregateScope = (
  cls: ClassDeclaration,
  declaration: Pick<DomainDeclaration, 'eventMethods' | 'inertMembers'>,
  files: readonly SourceFile[],
): AggregateScope => ({
  cls,
  eventMethods: new Set(declaration.eventMethods),
  inertMembers: new Set(declaration.inertMembers),
  leaksThis: leaksThis(cls, files),
});
