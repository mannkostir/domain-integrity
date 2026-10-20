import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';

export const SCHEMA_PATH = fileURLToPath(new URL('../../schema/report.schema.json', import.meta.url));

export const REPORT_SCHEMA: Readonly<Record<string, unknown>> = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(REPORT_SCHEMA);

export const validateReport = (text: string): readonly string[] =>
  validate(JSON.parse(text)) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`);
