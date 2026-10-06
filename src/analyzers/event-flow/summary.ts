import { relative } from 'node:path';
import { handlerLabel } from './checks/handler-label';
import { EventFlowModel } from './model';

export const eventFlowSummary = (model: EventFlowModel, root: string): string => {
  const ids = [...new Set(model.registrations.map((registration) => registration.event))].sort();
  if (ids.length === 0) return '';
  const lines = ids.map((id) => {
    const ref = model.classes.get(id);
    const handlers = model.registrations.filter((registration) => registration.event === id).map((registration) => handlerLabel(registration) ?? '(inline)');
    return `- ${ref?.name ?? id} (${ref === undefined ? '?' : relative(root, ref.file)}) → ${handlers.join(', ')}`;
  });
  return ['## Event flows', '', ...lines, ''].join('\n');
};
