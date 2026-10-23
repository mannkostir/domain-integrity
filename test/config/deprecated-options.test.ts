import { fileURLToPath } from 'node:url';
import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

const DEFINE = fileURLToPath(new URL('../../src/config/define.ts', import.meta.url));

const deprecationOf = (option: string): string | undefined => {
  const file = new Project({ skipAddingFilesFromTsConfig: true }).addSourceFileAtPath(DEFINE);
  const typeNode = file.getTypeAliasOrThrow('DomainConfig').getTypeNodeOrThrow();
  const member = Node.isTypeLiteral(typeNode) ? typeNode.getProperty(option) : undefined;
  return member
    ?.getJsDocs()
    .flatMap((doc) => doc.getTags())
    .find((tag) => tag.getTagName() === 'deprecated')
    ?.getCommentText();
};

describe('deprecated config options', () => {
  it.each([
    ['aggregateBaseClasses', 'Use aggregates.baseClasses.'],
    ['auditFields', 'Use aggregates.auditFields.'],
    ['eventMethods', 'Use events.raiseMethods.'],
    ['inertDecorators', 'Use inert.decorators.'],
    ['inertEventMethods', 'Use inert.raiseMethods.'],
    ['inertMembers', 'Use inert.members.'],
    ['reportTestFileMutations', "Use rules['outside-mutation'].testFiles."],
  ])('marks %s deprecated', (option, replacement) => {
    expect(deprecationOf(option)).toBe(replacement);
  });
});
