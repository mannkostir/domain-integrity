import { ClassDeclaration } from 'ts-morph';
import { DomainDeclaration } from '../../engine/declaration';
import { AggregateScope } from './field-ref';
import { plainEventArraysAmong } from '../shared/array-store';
import { assertedInertEventMethods } from './inert-event-method';
import { ProjectIndex } from './project-index';
import { classFamily, leaksThis } from './this-leak';

export const aggregateScope = (
  cls: ClassDeclaration,
  declaration: Pick<DomainDeclaration, 'eventMethods' | 'inertEventMethods' | 'inertMembers'>,
  project: Pick<ProjectIndex, 'sources' | 'bracketWrites' | 'subclasses'>,
): AggregateScope => {
  const family = classFamily(cls, project.subclasses);
  return {
    cls,
    eventMethods: new Set(declaration.eventMethods),
    inertEventMethods: assertedInertEventMethods(declaration.inertEventMethods, cls, family, project),
    inertMembers: new Set(declaration.inertMembers),
    leaksThis: leaksThis(family),
    plainEventArrays: plainEventArraysAmong(family, project.bracketWrites),
  };
};
