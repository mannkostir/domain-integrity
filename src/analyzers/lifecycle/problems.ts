import { ProblemOf } from '../../finding';

const SUPPORTED = 'supported state types are an enum, a string or number literal union, boolean, and a nullable non-literal type such as Date | null (requires strictNullChecks)';

export const stateFieldAccessor = (aggregate: string, field: string): ProblemOf<'state-field-accessor'> => ({
  code: 'state-field-accessor',
  analyzer: 'lifecycle',
  message: `${aggregate}.${field} is an accessor; declare its backing field instead`,
  details: { aggregate, field },
});

export const stateFieldMissing = (aggregate: string, field: string): ProblemOf<'state-field-missing'> => ({
  code: 'state-field-missing',
  analyzer: 'lifecycle',
  message: `${aggregate} has no field "${field}"`,
  details: { aggregate, field },
});

export const stateFieldUnsupportedType = (aggregate: string, field: string, type: string): ProblemOf<'state-field-unsupported-type'> => ({
  code: 'state-field-unsupported-type',
  analyzer: 'lifecycle',
  message: `${aggregate}.${field} has unsupported type "${type}"; ${SUPPORTED}`,
  details: { aggregate, field, type },
});

export const unknownStateValue = (aggregate: string, field: string, value: string, known: readonly string[]): ProblemOf<'unknown-state-value'> => ({
  code: 'unknown-state-value',
  analyzer: 'lifecycle',
  message: `${aggregate}.${field}: unknown state value "${value}" (known: ${known.join(', ')})`,
  details: { aggregate, field, value, known },
});

export const transitionMethodMissing = (aggregate: string, method: string): ProblemOf<'transition-method-missing'> => ({
  code: 'transition-method-missing',
  analyzer: 'lifecycle',
  message: `${aggregate}: transitions refer to missing method "${method}"`,
  details: { aggregate, method },
});
