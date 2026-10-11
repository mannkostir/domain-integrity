import { ClassDeclaration, Node, SourceFile } from 'ts-morph';
import { setsOf } from './assigned';
import { instanceAccessors } from './members';
import { AssignedValues, StateField } from './model';
import { outsideAssignments } from './outside';
import { hasUnknownWrite } from './values';

const mayChange = (value: AssignedValues): boolean => value.tokens.size > 0 || hasUnknownWrite(value);

const writtenByAny = (accessors: readonly Node[], field: StateField): boolean =>
  accessors.some((accessor) => mayChange(setsOf(accessor, field)));

const writtenOutsideClass = (files: readonly SourceFile[], cls: ClassDeclaration, field: StateField): boolean =>
  outsideAssignments(files, cls, field).length > 0;

export const fieldsWrittenOutsideMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
  files: readonly SourceFile[],
  fields: readonly StateField[],
): ReadonlySet<string> => {
  const accessors = instanceAccessors(cls, aggregateBaseClasses);
  return new Set(
    fields
      .filter((field) => writtenByAny(accessors, field) || writtenOutsideClass(files, cls, field))
      .map((field) => field.name),
  );
};
