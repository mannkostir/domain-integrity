import { ClassDeclaration, SourceFile } from 'ts-morph';
import { DomainDeclaration } from '../../engine/declaration';
import { AggregateScope } from './field-ref';
import { plainEventArrays } from './array-store';
import { assertedInertEventMethods, hasResolvedBases } from './inert-event-method';
import { classFamily, leaksThis } from './this-leak';

export const aggregateScope = (
  cls: ClassDeclaration,
  declaration: Pick<DomainDeclaration, 'eventMethods' | 'inertEventMethods' | 'inertMembers'>,
  files: readonly SourceFile[],
): AggregateScope => {
  const family = classFamily(cls, files);
  return {
    cls,
    eventMethods: new Set(declaration.eventMethods),
    inertEventMethods: hasResolvedBases(cls)
      ? assertedInertEventMethods(declaration.inertEventMethods, family, files)
      : new Set(),
    inertMembers: new Set(declaration.inertMembers),
    leaksThis: leaksThis(cls, files),
    plainEventArrays: plainEventArrays(family, files),
  };
};
