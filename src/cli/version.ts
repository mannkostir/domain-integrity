import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolIdentity } from '../report/tool';

const PACKAGE_NAME = 'domain-integrity';

const HOMEPAGE = 'https://github.com/mannkostir/domain-integrity#readme';

const UNKNOWN_VERSION = 'unknown version';

const ownVersion = (manifest: unknown): string | undefined =>
  typeof manifest === 'object' &&
  manifest !== null &&
  'name' in manifest &&
  manifest.name === PACKAGE_NAME &&
  'version' in manifest &&
  typeof manifest.version === 'string'
    ? manifest.version
    : undefined;

const readManifest = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const versionAbove = (directory: string): string => {
  const manifest = join(directory, 'package.json');
  const version = existsSync(manifest) ? ownVersion(readManifest(manifest)) : undefined;
  if (version !== undefined) return version;
  const parent = dirname(directory);
  return parent === directory ? UNKNOWN_VERSION : versionAbove(parent);
};

export const packageVersion = (): string => versionAbove(dirname(fileURLToPath(import.meta.url)));

export const toolIdentity = (): ToolIdentity => ({ name: PACKAGE_NAME, version: packageVersion(), informationUri: HOMEPAGE });
