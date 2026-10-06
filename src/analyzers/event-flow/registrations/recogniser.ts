import { ClassDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { DeclaredEvents } from '../../../engine/declaration';
import { ProjectClasses, resolveKey } from '../keys';
import { RawPayload } from '../payload';

export type RawRegistration = {
  readonly event: ClassDeclaration;
  readonly key: Node;
  readonly handler: ClassDeclaration | undefined;
  readonly method: string | undefined;
  readonly payload: RawPayload;
  readonly node: Node;
};

export type RecognisedSite =
  | { readonly kind: 'resolved'; readonly registrations: readonly RawRegistration[] }
  | { readonly kind: 'unresolved'; readonly node: Node };

export type RecogniserContext = { readonly events: DeclaredEvents; readonly isProject: ProjectClasses };

export type RegistrationRecogniser = {
  readonly sites: (file: SourceFile, context: RecogniserContext) => readonly RecognisedSite[];
};

export type ResolvedKeys =
  | { readonly kind: 'resolved'; readonly classes: readonly { readonly cls: ClassDeclaration; readonly key: Node }[] }
  | { readonly kind: 'unresolved' };

export const enclosingClass = (node: Node): ClassDeclaration | undefined => node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);

export const resolveKeys = (keys: readonly Node[], isProject: ProjectClasses): ResolvedKeys => {
  const resolutions = keys.map((key) => ({ key, resolution: resolveKey(key, isProject) }));
  if (keys.length === 0 || resolutions.some(({ resolution }) => resolution.kind === 'unresolved')) return { kind: 'unresolved' };
  return {
    kind: 'resolved',
    classes: resolutions.flatMap(({ key, resolution }) => (resolution.kind === 'project' ? [{ cls: resolution.cls, key }] : [])),
  };
};
