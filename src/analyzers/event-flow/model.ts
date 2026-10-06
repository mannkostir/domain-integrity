export type Location = { readonly file: string; readonly line: number };
export type ClassRef = { readonly id: string; readonly name: string; readonly qualifiedName: string } & Location;
export type Payload = ({ readonly kind: 'classes'; readonly classes: readonly string[] } & Location) | { readonly kind: 'unreadable' };
export type Registration = {
  readonly event: string;
  readonly handlerClass: string | undefined;
  readonly handlerMethod: string | undefined;
  readonly payload: Payload;
} & Location;
export type UnresolvedSite = { readonly owner: string | undefined } & Location;
export type EventClassModel = {
  readonly id: string;
  readonly abstract: boolean;
  readonly ancestors: readonly string[];
  readonly constructions: readonly Location[];
  readonly subclassed: boolean;
  readonly escaped: boolean;
  readonly instanceofChecked: boolean;
  readonly typedParameter: boolean;
  readonly namedInString: boolean;
};
export type SagaModel = {
  readonly id: string;
  readonly ancestors: readonly string[];
  readonly extendsForeign: boolean;
  readonly outcomes: readonly (readonly [string, string])[];
};
export type EventFlowModel = {
  readonly classes: ReadonlyMap<string, ClassRef>;
  readonly events: ReadonlyMap<string, EventClassModel>;
  readonly registrations: readonly Registration[];
  readonly unresolved: readonly UnresolvedSite[];
  readonly inProcess: readonly string[];
  readonly sagas: readonly SagaModel[];
  readonly problems: readonly string[];
};
