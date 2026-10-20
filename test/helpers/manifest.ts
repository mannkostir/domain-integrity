import { readFileSync } from 'node:fs';

type Manifest = { readonly version: string; readonly homepage: string };

export const MANIFEST: Manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
