export type OptionPath = readonly string[];

export type RenamedOption = { readonly old: OptionPath; readonly current: OptionPath };

export const RENAMED_OPTIONS = {
  aggregateBaseClasses: { old: ['aggregateBaseClasses'], current: ['aggregates', 'baseClasses'] },
  auditFields: { old: ['auditFields'], current: ['aggregates', 'auditFields'] },
  eventMethods: { old: ['eventMethods'], current: ['events', 'raiseMethods'] },
  inertDecorators: { old: ['inertDecorators'], current: ['inert', 'decorators'] },
  inertEventMethods: { old: ['inertEventMethods'], current: ['inert', 'raiseMethods'] },
  inertMembers: { old: ['inertMembers'], current: ['inert', 'members'] },
} as const satisfies Readonly<Record<string, RenamedOption>>;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const segmentText = (segment: string): string => (IDENTIFIER.test(segment) ? `.${segment}` : `['${segment}']`);

export const optionPath = ([first = '', ...rest]: OptionPath): string => `${first}${rest.map(segmentText).join('')}`;
