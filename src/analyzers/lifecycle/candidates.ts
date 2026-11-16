import { Node, SyntaxKind } from 'ts-morph';
import { SET } from '../../engine/value-token';
import { setsOf } from './assigned';
import { AggregateScope, referencesField } from './field-ref';
import { StateField } from './model';
import { isDataProperty, resolveStateField } from './state-field';

const fieldNames = (scope: AggregateScope): string[] => {
  const cls = scope.cls;
  const own = cls.getType().getProperties()
    .filter((symbol) => isDataProperty(symbol) || scope.javascriptData.prove(cls, symbol).kind === 'data')
    .map((symbol) => symbol.getName());
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

const ownMethodImplementations = (scope: AggregateScope): readonly Node[] => [
  ...scope.cls.getMethods(),
  ...scope.cls.getProperties().flatMap((property) => scope.arrowMethods.get(property) ?? []),
];

const behavesLikeState = (scope: AggregateScope, field: StateField): boolean =>
  field.kind !== 'nullable' ||
  ownMethodImplementations(scope).some((implementation) => setsOf(implementation, field, scope.cls, scope.projections?.assigned, scope.projections?.tracksTarget, scope.javascriptData).tokens.has(SET)) ||
  scope.cls
    .getDescendantsOfKind(SyntaxKind.IfStatement)
    .some((statement) => referencesField(statement.getExpression(), field.name, scope));

export const candidateFields = (scope: AggregateScope, auditFields: readonly string[]): StateField[] => {
  const excluded = new Set([...auditFields, 'props']);
  return fieldNames(scope)
    .filter((name) => !excluded.has(name))
    .map((name) => resolveStateField(scope.cls, name, scope.projections))
    .flatMap((resolution) => (resolution.kind === 'resolved' ? [resolution.field] : []))
    .filter((field) => behavesLikeState(scope, field));
};
