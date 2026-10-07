import { EventBufferFinding } from '../../../analyzer';
import { EventFlowModel, UndispatchedBuffer } from '../model';

const toFinding = (buffer: UndispatchedBuffer): EventBufferFinding => ({
  analyzer: 'event-flow',
  checkId: 'undispatched-events',
  severity: 'error',
  owner: buffer.owner,
  ownerId: buffer.ownerId,
  buffer: buffer.buffer,
  method: buffer.method,
  raisers: buffer.raisers,
  subject: '',
  file: buffer.file,
  line: buffer.line,
  message: `${buffer.owner}.${buffer.buffer} collects events from ${buffer.method}() raised by ${buffer.raisers.join(', ')}, but no production code reads or drains it, so those events never reach a handler.`,
  fix: `Dispatch the events in ${buffer.buffer} after saving the aggregate and clear it, or stop raising them.`,
});

export const undispatchedEvents = (model: EventFlowModel): EventBufferFinding[] => model.buffers.map(toFinding);
