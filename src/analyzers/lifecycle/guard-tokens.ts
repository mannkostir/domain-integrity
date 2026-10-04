import { SET, UNSET } from '../../engine/value-token';
import { Sources, StateField, UnsetForm } from './model';
import { allTokens, difference, union } from './values';

const formToken = (form: UnsetForm): string => `${UNSET}:${form}`;

const splitsUnset = (field: StateField): boolean =>
  field.kind === 'nullable' && field.unsetForms.includes('null') && field.unsetForms.includes('undefined');

export const unsetGuardTokens = (field: StateField): ReadonlySet<string> =>
  splitsUnset(field) ? new Set(field.unsetForms.map(formToken)) : new Set([UNSET]);

export const comparedUnsetTokens = (field: StateField, form: UnsetForm, strict: boolean): ReadonlySet<string> =>
  strict && splitsUnset(field) ? new Set([formToken(form)]) : unsetGuardTokens(field);

export const guardUniverse = (field: StateField): ReadonlySet<string> =>
  splitsUnset(field) ? union(new Set([SET]), unsetGuardTokens(field)) : allTokens(field);

export const collapseGuardTokens = (field: StateField, allowed: ReadonlySet<string>): Sources => {
  if (!splitsUnset(field)) return { kind: 'known', values: allowed };
  const unset = unsetGuardTokens(field);
  const coveredForms = [...unset].filter((token) => allowed.has(token)).length;
  if (coveredForms !== 0 && coveredForms !== unset.size) return { kind: 'unknown' };
  const fieldTokens = difference(allowed, unset);
  return { kind: 'known', values: coveredForms === 0 ? fieldTokens : union(fieldTokens, new Set([UNSET])) };
};
