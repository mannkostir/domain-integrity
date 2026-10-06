import { EventFlowFinding } from '../../../analyzer';
import { EventFlowModel, SagaModel } from '../model';
import { acceptedIds, nameOf, refOf } from './handler-label';

type Outcome = readonly [string, string];

const handlingClasses = (saga: SagaModel): ReadonlySet<string> => new Set([saga.id, ...saga.ancestors]);

const isSilenced = (model: EventFlowModel, saga: SagaModel): boolean => {
  const owners = handlingClasses(saga);
  return saga.extendsForeign || model.unresolved.some((site) => site.owner !== undefined && owners.has(site.owner));
};

const handles = (model: EventFlowModel, saga: SagaModel, eventId: string): boolean => {
  const owners = handlingClasses(saga);
  const accepted = acceptedIds(model, eventId);
  return model.registrations.some(
    (registration) => registration.handlerClass !== undefined && owners.has(registration.handlerClass) && accepted.has(registration.event),
  );
};

const judged = (model: EventFlowModel): readonly { readonly saga: SagaModel; readonly outcome: Outcome }[] =>
  model.sagas.filter((saga) => !isSilenced(model, saga)).flatMap((saga) => saga.outcomes.map((outcome) => ({ saga, outcome })));

export const sagaMissingFailurePath = (model: EventFlowModel): EventFlowFinding[] =>
  judged(model)
    .filter(({ saga, outcome: [success, failure] }) => handles(model, saga, success) && !handles(model, saga, failure))
    .map(({ saga, outcome: [success, failure] }): EventFlowFinding => {
      const sagaRef = refOf(model, saga.id);
      const sagaName = sagaRef.name;
      const failureName = nameOf(model, failure);
      return {
        analyzer: 'event-flow',
        checkId: 'saga-missing-failure-path',
        severity: 'error',
        event: failureName,
        eventId: failure,
        handler: saga.id,
        subject: success,
        file: sagaRef.file,
        line: sagaRef.line,
        message: `${sagaName} handles ${nameOf(model, success)} but not its declared failure ${failureName}.`,
        fix: `Handle ${failureName} in ${sagaName}, for example with a compensating command.`,
      };
    });

export const sagaProblems = (model: EventFlowModel): string[] =>
  judged(model)
    .filter(({ saga, outcome: [success, failure] }) => !handles(model, saga, success) && !handles(model, saga, failure))
    .map(({ saga, outcome: [success, failure] }) => {
      const sagaName = nameOf(model, saga.id);
      return `saga(${sagaName}) declares the outcome ${nameOf(model, success)} → ${nameOf(model, failure)}, but ${sagaName} handles neither.`;
    });
