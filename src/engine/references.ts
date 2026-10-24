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

const referencesOf = (tsconfig: string, referrer: string | undefined, read: ReadReferences): readonly string[] => {
  const result = read(tsconfig);
  if (result.kind === 'read') return result.references;
  const origin = referrer === undefined ? '' : ` (referenced from ${referrer})`;
  throw new ProjectError(
    result.kind === 'missing' ? `tsconfig not found: ${tsconfig}${origin}` : `Cannot load ${tsconfig}${origin}: ${result.reason}`,
  );
};

export const referencedTsconfigs = (entry: string, read: ReadReferences): readonly string[] => {
  const visited = new Set<string>([entry]);
  const reached: string[] = [];
  const visit = (tsconfig: string, referrer: string | undefined): void => {
    referencesOf(tsconfig, referrer, read).forEach((reference) => {
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
