import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RENAMED_OPTIONS, optionPath } from '../src/engine/renamed-options';

const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

const MIGRATION = README.slice(README.indexOf('### Migrating from 0.2'));

describe('README migration table', () => {
  it.each(Object.values(RENAMED_OPTIONS))('maps $old to $current', (option) => {
    expect(MIGRATION).toContain(`| \`${optionPath(option.old)}\` | \`${optionPath(option.current)}\` |`);
  });

  it('maps a bare transitions array to from', () => {
    expect(MIGRATION).toContain('| `transitions.<method>: [...]` | `transitions.<method>: { from: [...] }` |');
  });
});

describe('README rules section', () => {
  const RULES = README.slice(README.indexOf('## Rules and suppressions'));

  it.each(['off', 'warning', 'error', 'testFiles', 'suppress(', 'reason', 'stale suppression'])('mentions %s', (term) => {
    expect(RULES).toContain(term);
  });
});
