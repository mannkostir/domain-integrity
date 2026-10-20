import { Finding, RuleDescription, findingKey } from '../analyzer';
import { toPosixRelative } from '../engine/path';
import { Report } from './text';
import { ToolIdentity } from './tool';

export const FINGERPRINT = 'domainIntegrity/v1';

const BASELINE_SUPPRESSION = { kind: 'external', justification: 'Recorded in the domain-integrity baseline.' } as const;

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

const ruleIndexOf = (rules: readonly RuleDescription[], ruleId: string): number => {
  const index = rules.findIndex((rule) => rule.id === ruleId);
  if (index === -1) throw new Error(`The report has a finding under the undeclared rule ${ruleId}.`);
  return index;
};

const sarifResult = (finding: Finding, report: Report) => ({
  ruleId: finding.checkId,
  ruleIndex: ruleIndexOf(report.rules, finding.checkId),
  level: finding.severity,
  message: { text: finding.message },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: toPosixRelative(report.root, finding.file) },
        region: { startLine: finding.line },
      },
    },
  ],
  partialFingerprints: { [FINGERPRINT]: findingKey(finding) },
  properties: { fix: finding.fix },
});

const suppressedResult = (finding: Finding, report: Report) => ({ ...sarifResult(finding, report), suppressions: [BASELINE_SUPPRESSION] });

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
          results: [
            ...report.fresh.map((finding) => sarifResult(finding, report)),
            ...report.known.map((finding) => suppressedResult(finding, report)),
          ],
        },
      ],
    },
    null,
    2,
  )}\n`;
