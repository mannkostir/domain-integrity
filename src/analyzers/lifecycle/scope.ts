import { ClassDeclaration } from 'ts-morph';
import { DomainDeclaration } from '../../engine/declaration';
import { arrowMethods } from './arrow-methods';
import { AggregateScope } from './field-ref';
import { plainEventArrays } from '../shared/array-store';
import { eventBuffers } from './event-buffer';
import { assertedInertEventMethods } from './inert-event-method';
import { ProjectIndex } from './project-index';
import { classFamily, leaksThis } from './this-leak';

export const aggregateScope = (
  cls: ClassDeclaration,
  declaration: Pick<DomainDeclaration, 'eventMethods' | 'inertDecorators' | 'inertEventMethods' | 'inertMembers'>,
  project: Pick<ProjectIndex, 'sources' | 'bracketWrites' | 'nameUses' | 'subclasses'>,
): AggregateScope => {
  const family = classFamily(cls, project.subclasses);
  const arrows = arrowMethods(family, project.nameUses);
  return {
    cls,
    eventMethods: new Set(declaration.eventMethods),
    inertEventMethods: assertedInertEventMethods(declaration.inertEventMethods, cls, family, project, declaration.inertDecorators),
    inertMembers: new Set(declaration.inertMembers),
    leaksThis: leaksThis(family, arrows),
    plainEventArrays: plainEventArrays(family, project.bracketWrites, declaration.inertDecorators),
    eventBuffers: eventBuffers(family, project.bracketWrites, declaration.inertDecorators, new Set(declaration.eventMethods)),
    arrowMethods: arrows,
  };
};
