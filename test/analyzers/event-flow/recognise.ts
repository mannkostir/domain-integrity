import { ClassDeclaration } from 'ts-morph';
import { RecognisedSite, RegistrationRecogniser } from '../../../src/analyzers/event-flow/registrations/recogniser';
import { DEFAULT_DECLARATION, DeclaredEvents } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const describeSite = (site: RecognisedSite): string =>
  site.kind === 'unresolved'
    ? `unresolved@${site.node.getStartLineNumber()}`
    : site.registrations
        .map((registration) => {
          const payload = registration.payload.kind === 'classes' ? registration.payload.classes.map((cls) => cls.getName()).join('|') : '?';
          return `${registration.event.getName()} -> ${registration.handler?.getName() ?? '-'}.${registration.method ?? '-'} (${payload})`;
        })
        .join(', ');

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
