import { RuleDescription } from '../analyzer';
import { toPosixRelative } from '../engine/path';
import { Report } from './text';
import { ToolIdentity } from './tool';

const ruleReference = (informationUri: string, ruleId: string): string => {
  const url = new URL(informationUri);
  url.hash = ruleId;
  return url.href;
};

const sarifRule = (rule: RuleDescription, tool: ToolIdentity) => {
  const helpUri = tool.informationUri === undefined ? undefined : ruleReference(tool.informationUri, rule.id);
  return {
    id: rule.id,
    shortDescription: { text: rule.description },
    fullDescription: { text: rule.explanation },
    help: { text: rule.remedy, markdown: helpUri === undefined ? rule.remedy : `${rule.remedy}\n\n[Rule reference](${helpUri})` },
    ...(helpUri === undefined ? {} : { helpUri }),
    defaultConfiguration: { level: rule.severity },
  };
};

export const formatSarif = (report: Report, tool: ToolIdentity): string =>
  `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: tool.name,
              version: tool.version,
              informationUri: tool.informationUri,
              rules: report.rules.map((rule) => sarifRule(rule, tool)),
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
