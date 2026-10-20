import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolIdentity } from '../report/tool';

const PACKAGE_NAME = 'domain-integrity';

const UNKNOWN_VERSION = 'unknown version';

type OwnManifest = { readonly version: string; readonly homepage?: string };

const isAbsoluteUrl = (value: unknown): value is string => typeof value === 'string' && URL.canParse(value);

const ownManifest = (manifest: unknown): OwnManifest | undefined => {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  if (!('name' in manifest) || manifest.name !== PACKAGE_NAME) return undefined;
  if (!('version' in manifest) || typeof manifest.version !== 'string') return undefined;
  const homepage = 'homepage' in manifest && isAbsoluteUrl(manifest.homepage) ? manifest.homepage : undefined;
  return homepage === undefined ? { version: manifest.version } : { version: manifest.version, homepage };
};

const readManifest = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const manifestAbove = (directory: string): OwnManifest | undefined => {
  const path = join(directory, 'package.json');
  const manifest = existsSync(path) ? ownManifest(readManifest(path)) : undefined;
  if (manifest !== undefined) return manifest;
  const parent = dirname(directory);
  return parent === directory ? undefined : manifestAbove(parent);
};

export const toolIdentityAt = (directory: string): ToolIdentity => {
  const manifest = manifestAbove(directory);
  const version = manifest?.version ?? UNKNOWN_VERSION;
  return manifest?.homepage === undefined
    ? { name: PACKAGE_NAME, version }
    : { name: PACKAGE_NAME, version, informationUri: manifest.homepage };
};

export const toolIdentity = (): ToolIdentity => toolIdentityAt(dirname(fileURLToPath(import.meta.url)));

export const packageVersion = (): string => toolIdentity().version;
