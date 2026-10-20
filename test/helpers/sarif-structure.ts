type JsonObject = Readonly<Record<string, unknown>>;

const LEVELS: readonly unknown[] = ['error', 'warning', 'note', 'none'];

const SUPPRESSION_KINDS: readonly unknown[] = ['inSource', 'external'];

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

const at = (value: unknown, ...keys: readonly string[]): unknown => keys.reduce(field, value);

const entries = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const isPositiveInteger = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 1;

const violationIf = (violated: boolean, violation: string): readonly string[] => (violated ? [violation] : []);

const isRelativeUri = (uri: string): boolean => !uri.startsWith('/') && !uri.includes('\\') && !URI_SCHEME.test(uri);

const ruleIdsOf = (rules: readonly unknown[]): readonly unknown[] => rules.map((rule) => field(rule, 'id'));

const ruleViolations = (rule: unknown, where: string): readonly string[] => [
  ...violationIf(typeof field(rule, 'id') !== 'string' || field(rule, 'id') === '', `${where}.id is not a non-empty string`),
  ...violationIf(!LEVELS.includes(at(rule, 'defaultConfiguration', 'level')), `${where}.defaultConfiguration.level is not a SARIF level`),
];

const duplicateIdViolations = (ids: readonly unknown[], where: string): readonly string[] =>
  ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `${where} declares rule id ${String(id)} more than once`);

const locationViolations = (location: unknown, where: string): readonly string[] => {
  const uri = at(location, 'physicalLocation', 'artifactLocation', 'uri');
  return [
    ...violationIf(typeof uri !== 'string' || !isRelativeUri(uri), `${where}.physicalLocation.artifactLocation.uri is not a relative uri`),
    ...violationIf(!isPositiveInteger(at(location, 'physicalLocation', 'region', 'startLine')), `${where}.physicalLocation.region.startLine is not a line number`),
  ];
};

const fingerprintViolations = (fingerprints: unknown, where: string): readonly string[] =>
  isObject(fingerprints)
    ? Object.entries(fingerprints).flatMap(([name, value]) => violationIf(typeof value !== 'string', `${where}.partialFingerprints.${name} is not a string`))
    : [`${where}.partialFingerprints is not an object`];

const suppressionViolations = (suppressions: unknown, where: string): readonly string[] => {
  if (suppressions === undefined) return [];
  if (!Array.isArray(suppressions)) return [`${where}.suppressions is not an array`];
  return suppressions.flatMap((suppression: unknown, index) =>
    violationIf(!SUPPRESSION_KINDS.includes(field(suppression, 'kind')), `${where}.suppressions[${index}].kind is not a suppression kind`),
  );
};

const ruleReferenceViolations = (result: unknown, ruleIds: readonly unknown[], where: string): readonly string[] => {
  const ruleId = field(result, 'ruleId');
  const ruleIndex = field(result, 'ruleIndex');
  return [
    ...violationIf(typeof ruleId !== 'string' || !ruleIds.includes(ruleId), `${where}.ruleId names no rule`),
    ...violationIf(!Number.isInteger(ruleIndex) || ruleIds[Number(ruleIndex)] !== ruleId, `${where}.ruleIndex does not point at the rule ${String(ruleId)}`),
  ];
};

const resultViolations = (result: unknown, ruleIds: readonly unknown[], where: string): readonly string[] => {
  const locations = field(result, 'locations');
  return [
    ...violationIf(typeof at(result, 'message', 'text') !== 'string', `${where}.message.text is not a string`),
    ...ruleReferenceViolations(result, ruleIds, where),
    ...violationIf(!LEVELS.includes(field(result, 'level')), `${where}.level is not a SARIF level`),
    ...fingerprintViolations(field(result, 'partialFingerprints'), where),
    ...suppressionViolations(field(result, 'suppressions'), where),
    ...violationIf(!Array.isArray(locations) || locations.length === 0, `${where}.locations is not a non-empty array`),
    ...entries(locations).flatMap((location, index) => locationViolations(location, `${where}.locations[${index}]`)),
  ];
};

const runViolations = (run: unknown, where: string): readonly string[] => {
  const rules = at(run, 'tool', 'driver', 'rules');
  const results = field(run, 'results');
  const ruleIds = ruleIdsOf(entries(rules));
  return [
    ...violationIf(typeof at(run, 'tool', 'driver', 'name') !== 'string', `${where}.tool.driver.name is not a string`),
    ...violationIf(!Array.isArray(rules), `${where}.tool.driver.rules is not an array`),
    ...entries(rules).flatMap((rule, index) => ruleViolations(rule, `${where}.tool.driver.rules[${index}]`)),
    ...duplicateIdViolations(ruleIds, `${where}.tool.driver.rules`),
    ...violationIf(!Array.isArray(results), `${where}.results is not an array`),
    ...entries(results).flatMap((result, index) => resultViolations(result, ruleIds, `${where}.results[${index}]`)),
  ];
};

export const sarifViolations = (log: unknown): readonly string[] => {
  const runs = field(log, 'runs');
  return [
    ...violationIf(field(log, 'version') !== '2.1.0', 'version is not 2.1.0'),
    ...violationIf(!Array.isArray(runs) || runs.length === 0, 'runs is not a non-empty array'),
    ...entries(runs).flatMap((run, index) => runViolations(run, `runs[${index}]`)),
  ];
};
