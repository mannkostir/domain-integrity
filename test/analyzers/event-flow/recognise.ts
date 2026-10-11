import { ClassDeclaration, Node } from 'ts-morph';
import { HandlerBound } from '../../../src/analyzers/event-flow/registrations/handler-bound';
import { RawRegistration, RecognisedSite, RegistrationRecogniser } from '../../../src/analyzers/event-flow/registrations/recogniser';
import { DEFAULT_DECLARATION, DeclaredEvents } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const describeRegistration = (registration: RawRegistration): string => {
  const payload = registration.payload.kind === 'classes' ? registration.payload.classes.map((cls) => cls.getName()).join('|') : '?';
  return `${registration.event.getName()} -> ${registration.handler?.getName() ?? '-'}.${registration.method ?? '-'} (${payload})`;
};

const describeBound = (bound: HandlerBound, node: Node): string => (bound.kind === 'types' ? ` (${bound.types.map(({ type }) => type.getText(node)).join(', ')})` : '');

const describeSite = (site: RecognisedSite): string =>
  site.kind === 'unresolved'
    ? `unresolved@${site.node.getStartLineNumber()}${describeBound(site.bound, site.node)}`
    : [...site.registrations.map(describeRegistration), ...(site.libraryKeyed ? ['library'] : [])].join(', ');

export const recognise = (
  recogniser: RegistrationRecogniser,
  sources: Readonly<Record<string, string>>,
  events: Partial<DeclaredEvents> = {},
): readonly string[] => {
  const project = inMemoryProject({ '/types/lib.d.ts': 'export declare class LibraryEvent {}', ...sources });
  const isProject = (cls: ClassDeclaration) => !cls.getSourceFile().isDeclarationFile() && cls.getSourceFile().getFilePath() !== '/lib/domain-integrity.ts';
  const context = { events: { ...DEFAULT_DECLARATION.events, ...events }, isProject };
  return project
    .getSourceFiles()
    .filter((file) => file.getFilePath().startsWith('/src/'))
    .flatMap((file) => recogniser.sites(file, context))
    .map(describeSite)
    .filter((description) => description.length > 0);
};
