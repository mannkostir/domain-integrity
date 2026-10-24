import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { ProjectError } from './errors';
import { toTypeScriptPath } from './path';

export type ReferenceRead =
  | { readonly kind: 'read'; readonly references: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type ReadReferences = (tsconfig: string) => ReferenceRead;

export type ShowPath = (path: string) => string;

const missingTsconfigMessage = (tsconfig: string): string =>
  `tsconfig not found: ${tsconfig}. Run domain-integrity from the project root, or pass -p with the path to your tsconfig.json or the directory that contains it.`;

const missingReferenceMessage = (tsconfig: string, referrer: string): string =>
  `tsconfig not found: ${tsconfig} (referenced from ${referrer}). Correct the path in the "references" of ${referrer}.`;

const missingMessage = (tsconfig: string, referrer: string | undefined): string =>
  referrer === undefined ? missingTsconfigMessage(tsconfig) : missingReferenceMessage(tsconfig, referrer);

const unreadableMessage = (tsconfig: string, referrer: string | undefined, reason: string): string =>
  referrer === undefined ? `Cannot load ${tsconfig}: ${reason}` : `Cannot load ${tsconfig} (referenced from ${referrer}): ${reason}`;

const referencesOf = (tsconfig: string, referrer: string | undefined, read: ReadReferences, shown: ShowPath): readonly string[] => {
  const result = read(tsconfig);
  if (result.kind === 'read') return result.references;
  const shownReferrer = referrer === undefined ? undefined : shown(referrer);
  throw new ProjectError(
    result.kind === 'missing' ? missingMessage(shown(tsconfig), shownReferrer) : unreadableMessage(shown(tsconfig), shownReferrer, result.reason),
  );
};

export const referencedTsconfigs = (entry: string, read: ReadReferences, shown: ShowPath): readonly string[] => {
  const visited = new Set<string>([entry]);
  const reached: string[] = [];
  const visit = (tsconfig: string, referrer: string | undefined): void => {
    referencesOf(tsconfig, referrer, read, shown).forEach((reference) => {
      if (visited.has(reference)) return;
      visited.add(reference);
      reached.push(reference);
      visit(reference, tsconfig);
    });
  };
  visit(entry, undefined);
  return reached;
};

const diagnosticText = (diagnostic: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

export const readReferencesFromDisk: ReadReferences = (tsconfig) => {
  if (!existsSync(tsconfig)) return { kind: 'missing' };
  const configFileName = toTypeScriptPath(tsconfig);
  const { config, error } = ts.readConfigFile(configFileName, ts.sys.readFile);
  if (error) return { kind: 'unreadable', reason: diagnosticText(error) };
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(configFileName), undefined, configFileName);
  return {
    kind: 'read',
    references: (parsed.projectReferences ?? []).map((reference) => resolve(ts.resolveProjectReferencePath(reference))),
  };
};
