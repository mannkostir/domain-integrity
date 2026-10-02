import { toPosixRelative } from './path';
import { Report } from './text';

export const formatSarif = (report: Report): string =>
  `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'domain-integrity',
              rules: report.rules.map((rule) => ({ id: rule.id, shortDescription: { text: rule.description } })),
            },
          },
          results: report.fresh.map((finding) => ({
            ruleId: finding.checkId,
            level: finding.severity,
            message: { text: `${finding.message} Fix: ${finding.fix}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: toPosixRelative(report.root, finding.file) },
                  region: { startLine: finding.line },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;
