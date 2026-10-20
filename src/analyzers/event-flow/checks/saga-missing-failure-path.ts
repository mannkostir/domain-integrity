import { reportedUnder } from '../../../analyzer';
import { FindingOf, Problem } from '../../../finding';
import { sagaOutcomeUnhandled } from '../problems';
import { EventClassModel, EventFlowModel, SagaModel } from '../model';
import { acceptedIds, nameOf, refOf } from './handler-label';
import { SAGA_MISSING_FAILURE_PATH } from './rules';

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

export const sagaMissingFailurePath = (model: EventFlowModel): FindingOf<'saga-missing-failure-path'>[] =>
  judged(model)
    .filter(({ saga, outcome: [success, failure] }) => handles(model, saga, success) && !handles(model, saga, failure))
    .map(({ saga, outcome: [success, failure] }): FindingOf<'saga-missing-failure-path'> => {
      const sagaRef = refOf(model, saga.id);
      const sagaName = sagaRef.name;
      const successName = nameOf(model, success);
      const failureName = nameOf(model, failure);
      return {
        ...reportedUnder(SAGA_MISSING_FAILURE_PATH),
        analyzer: 'event-flow',
        file: sagaRef.file,
        line: sagaRef.line,
        message: `${sagaName} handles ${successName} but not its declared failure ${failureName}.`,
        fix: `Handle ${failureName} in ${sagaName}, for example with a compensating command.`,
        details: { saga: sagaName, sagaId: saga.id, success: successName, successId: success, failure: failureName, failureId: failure },
      };
    });

export const sagaProblems = (model: EventFlowModel): Problem[] =>
  judged(model)
    .filter(({ saga, outcome: [success, failure] }) => !handles(model, saga, success) && !handles(model, saga, failure))
    .map(({ saga, outcome: [success, failure] }) => sagaOutcomeUnhandled(nameOf(model, saga.id), nameOf(model, success), nameOf(model, failure)));
