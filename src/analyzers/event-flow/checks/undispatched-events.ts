import { reportedUnder } from '../../../analyzer';
import { FindingOf } from '../../../finding';
import { EventFlowModel, UndispatchedBuffer } from '../model';
import { UNDISPATCHED_EVENTS } from './rules';

const toFinding = (buffer: UndispatchedBuffer): FindingOf<'undispatched-events'> => ({
  ...reportedUnder(UNDISPATCHED_EVENTS),
  analyzer: 'event-flow',
  file: buffer.file,
  line: buffer.line,
  message: `${buffer.owner}.${buffer.buffer} collects events from ${buffer.method}() raised by ${buffer.raiserNames.join(', ')}, but no production code reads or drains it, so those events never reach a handler.`,
  fix: `Dispatch the events in ${buffer.buffer} after saving the aggregate and clear it, or stop raising them.`,
  details: { owner: buffer.owner, ownerId: buffer.ownerId, buffer: buffer.buffer, method: buffer.method, raisers: buffer.raisers },
});

export const undispatchedEvents = (model: EventFlowModel): FindingOf<'undispatched-events'>[] => model.buffers.map(toFinding);
