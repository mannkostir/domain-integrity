import { readFileSync } from 'node:fs';

type Manifest = {
  readonly version: string;
  readonly homepage: string;
  readonly publishConfig?: { readonly provenance?: boolean };
  readonly exports: { readonly '.': Readonly<Record<string, string>> };
};

export const MANIFEST: Manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
