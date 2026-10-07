import { HandlerFinding } from '../../../analyzer';
import { EventClassModel, EventFlowModel, SagaModel } from '../model';
import { acceptedIds, nameOf, refOf } from './handler-label';

type Outcome = readonly [string, string];

const handlingClasses = (saga: SagaModel): ReadonlySet<string> => new Set([saga.id, ...saga.ancestors]);

const isSilenced = (model: EventFlowModel, saga: SagaModel): boolean => saga.extendsForeign || model.unresolved.length > 0;

const mightBeHandledUnseen = (event: EventClassModel | undefined): boolean =>
  event === undefined || event.opaque || event.escaped || event.instanceofChecked || event.namedInString || event.typedHandling;

const isOutcomeSilenced = (model: EventFlowModel, saga: SagaModel, [success, failure]: Outcome): boolean => {
  const owners = handlingClasses(saga);
  const failureEvent = model.events.get(failure);
  const libraryKeyedHere = model.libraryKeyed.some((owner) => owner !== undefined && owners.has(owner));
  return model.events.get(success)?.opaque !== false || mightBeHandledUnseen(failureEvent) || (failureEvent?.extendsLibrary === true && libraryKeyedHere);
};

const handles = (model: EventFlowModel, saga: SagaModel, eventId: string): boolean => {
  const owners = handlingClasses(saga);
  const accepted = acceptedIds(model, eventId);
  return model.registrations.some(
    (registration) => registration.handlerClass !== undefined && owners.has(registration.handlerClass) && accepted.has(registration.event),
  );
};

const judged = (model: EventFlowModel): readonly { readonly saga: SagaModel; readonly outcome: Outcome }[] =>
  model.sagas
    .filter((saga) => !isSilenced(model, saga))
    .flatMap((saga) => saga.outcomes.map((outcome) => ({ saga, outcome })))
    .filter(({ saga, outcome }) => !isOutcomeSilenced(model, saga, outcome));

export const sagaMissingFailurePath = (model: EventFlowModel): HandlerFinding[] =>
  judged(model)
    .filter(({ saga, outcome: [success, failure] }) => handles(model, saga, success) && !handles(model, saga, failure))
    .map(({ saga, outcome: [success, failure] }): HandlerFinding => {
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
