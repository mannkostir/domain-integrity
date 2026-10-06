import { relative } from 'node:path';
import { labelsOf } from './checks/format';
import { AggregateModel, FieldDeclaration, LifecycleModel, StateField } from './model';
import { writesField } from './values';

const RULES = [
  '## Domain lifecycles',
  '',
  'Rules for changing these aggregates:',
  '- Never change an aggregate after it reaches a terminal state, except through the listed methods.',
  "- Change state only through the aggregate's own methods.",
  '- Run `domain-integrity check` after changing domain code.',
];

const joined = (field: StateField, tokens: Iterable<string>): string => labelsOf(field, tokens).join(', ');

const transitionLines = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): string[] =>
  aggregate.methods.flatMap((method) => {
    const behaviour = method.fields.get(field.name);
    if (!behaviour || !writesField(behaviour.sets)) return [];
    const declared = declaration.transitions?.get(method.name);
    const from = declared
      ? joined(field, declared)
      : behaviour.sources.kind === 'known'
        ? joined(field, behaviour.sources.values)
        : 'unknown';
    const observed = !declared && behaviour.sources.kind === 'known' ? ' (observed)' : '';
    const to = [...labelsOf(field, behaviour.sets.tokens), ...(behaviour.sets.unresolved ? ['(computed)'] : [])].join(', ');
    return [`  - ${method.name}: ${from} → ${to}${observed}`];
  });

const fieldLines = (aggregate: AggregateModel, field: StateField, declaration: FieldDeclaration): string[] => [
  `- ${field.name}: ${field.values.map((value) => value.label).join(', ')}`,
  `  - terminal: ${joined(field, declaration.terminal) || 'none'}`,
  ...(declaration.allowAfterTerminal.size > 0
    ? [`  - may run after terminal: ${[...declaration.allowAfterTerminal].join(', ')}`]
    : []),
  ...transitionLines(aggregate, field, declaration),
];

const aggregateSection = (aggregate: AggregateModel, root: string): string[] => [
  `### ${aggregate.name} (${relative(root, aggregate.file)})`,
  ...aggregate.fields.flatMap((field) => {
    const declaration = aggregate.declarations.get(field.name);
    return declaration ? fieldLines(aggregate, field, declaration) : [];
  }),
  ...(aggregate.allowAfterTerminal.size > 0
    ? [`- may run after a terminal state: ${[...aggregate.allowAfterTerminal].join(', ')}`]
    : []),
];

export const lifecycleSummary = (model: LifecycleModel, root: string): string =>
  [
    ...RULES,
    ...model.aggregates.filter((aggregate) => aggregate.declared).flatMap((aggregate) => ['', ...aggregateSection(aggregate, root)]),
    '',
  ].join('\n');
