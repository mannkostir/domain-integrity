import { ClassDeclaration, SourceFile } from 'ts-morph';
import { DomainDeclaration } from '../../engine/declaration';
import { AggregateScope } from './field-ref';
import { plainEventArrays } from '../shared/array-store';
import { assertedInertEventMethods } from './inert-event-method';
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
    inertEventMethods: assertedInertEventMethods(declaration.inertEventMethods, cls, family, files),
    inertMembers: new Set(declaration.inertMembers),
    leaksThis: leaksThis(cls, files),
    plainEventArrays: plainEventArrays(family, files),
  };
};
