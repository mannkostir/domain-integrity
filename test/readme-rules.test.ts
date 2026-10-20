import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_RULES } from './helpers/rules';

const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

type Heading = { readonly slug: string; readonly line: number };

type Scan = { readonly fenced: boolean; readonly headings: readonly Heading[] };

const FENCE = /^\s*(```|~~~)/;

const HEADING = /^#{1,6}\s+(.*)$/;

const githubSlug = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');

const LINES = README.split('\n');

const scanLine = (scan: Scan, line: string, index: number): Scan => {
  if (FENCE.test(line)) return { ...scan, fenced: !scan.fenced };
  const text = scan.fenced ? undefined : HEADING.exec(line)?.[1];
  return text === undefined ? scan : { ...scan, headings: [...scan.headings, { slug: githubSlug(text), line: index }] };
};

const HEADINGS = LINES.reduce<Scan>(scanLine, { fenced: false, headings: [] }).headings;

const withoutCodeSpans = (text: string): string => text.replace(/`/g, '');

const sectionOf = (id: string): string => {
  const start = HEADINGS.findIndex((heading) => heading.slug === id);
  const heading = HEADINGS[start];
  const end = HEADINGS[start + 1]?.line ?? LINES.length;
  return heading === undefined ? '' : withoutCodeSpans(LINES.slice(heading.line + 1, end).join('\n'));
};

describe('README rule reference', () => {
  it('has a heading anchored at every rule id', () => {
    const slugs = HEADINGS.map((heading) => heading.slug);

    expect(slugs).toEqual(expect.arrayContaining(ALL_RULES.map((rule) => rule.id)));
  });

  it('anchors no two headings at the same rule id', () => {
    const ids = new Set<string>(ALL_RULES.map((rule) => rule.id));

    const anchoredAtRules = HEADINGS.filter((heading) => ids.has(heading.slug)).map((heading) => heading.slug);

    expect(anchoredAtRules.length).toBe(new Set(anchoredAtRules).size);
  });

  it.each(ALL_RULES)('carries the explanation of $id under its heading', (rule) => {
    const section = sectionOf(rule.id);

    expect(section).toContain(rule.explanation);
  });

  it.each(ALL_RULES)('carries the remedy of $id under its heading', (rule) => {
    const section = sectionOf(rule.id);

    expect(section).toContain(rule.remedy);
  });
});
