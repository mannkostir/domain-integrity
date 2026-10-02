import { ClassDeclaration, SyntaxKind } from 'ts-morph';
import { SET } from '../../engine/value-token';
import { setsOf } from './assigned';
import { AggregateScope, referencesField } from './field-ref';
import { StateField } from './model';
import { isDataProperty, resolveStateField } from './state-field';

const fieldNames = (cls: ClassDeclaration): string[] => {
  const own = cls.getType().getProperties().filter(isDataProperty).map((symbol) => symbol.getName());
  const props =
    cls
      .getType()
      .getProperty('props')
      ?.getTypeAtLocation(cls)
      .getProperties()
      .filter(isDataProperty)
      .map((symbol) => symbol.getName()) ?? [];
  return [...new Set([...own, ...props])];
};

const behavesLikeState = (scope: AggregateScope, field: StateField): boolean =>
  field.kind !== 'nullable' ||
  scope.cls.getMethods().some((method) => setsOf(method, field).tokens.has(SET)) ||
  scope.cls
    .getDescendantsOfKind(SyntaxKind.IfStatement)
    .some((statement) => referencesField(statement.getExpression(), field.name, scope));

export const candidateFields = (scope: AggregateScope, auditFields: readonly string[]): StateField[] => {
  const excluded = new Set([...auditFields, 'props']);
  return fieldNames(scope.cls)
    .filter((name) => !excluded.has(name))
    .map((name) => resolveStateField(scope.cls, name))
    .flatMap((resolution) => (resolution.kind === 'resolved' ? [resolution.field] : []))
    .filter((field) => behavesLikeState(scope, field));
};
