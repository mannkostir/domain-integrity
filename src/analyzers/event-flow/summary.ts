import { handlerLabel } from './checks/handler-label';
import { EventFlowModel } from './model';
import { toPosixRelative } from '../../engine/path';

const byDisplayName = (model: EventFlowModel, left: string, right: string): number =>
  (model.classes.get(left)?.name ?? left).localeCompare(model.classes.get(right)?.name ?? right) || left.localeCompare(right);

export const eventFlowSummary = (model: EventFlowModel, root: string): string => {
  const ids = [...new Set(model.registrations.map((registration) => registration.event))].sort((left, right) => byDisplayName(model, left, right));
  if (ids.length === 0) return '';
  const lines = ids.map((id) => {
    const ref = model.classes.get(id);
    const handlers = model.registrations.filter((registration) => registration.event === id).map((registration) => handlerLabel(model, registration) ?? '(inline)');
    return `- ${ref?.name ?? id} (${ref === undefined ? '?' : toPosixRelative(root, ref.file)}) → ${handlers.join(', ')}`;
  });
  return ['## Event flows', '', ...lines, ''].join('\n');
};
