export type SarifText = { readonly text: string };

export type SarifRule = {
  readonly id: string;
  readonly shortDescription: SarifText;
  readonly fullDescription: SarifText;
  readonly help: { readonly text: string; readonly markdown: string };
  readonly helpUri?: string;
  readonly defaultConfiguration: { readonly level: string };
};

export type SarifLocation = {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string };
    readonly region: { readonly startLine: number };
  };
};

export type SarifResult = {
  readonly ruleId: string;
  readonly level: string;
  readonly message: SarifText;
  readonly locations: readonly SarifLocation[];
};

export type SarifDriver = {
  readonly name: string;
  readonly version: string;
  readonly informationUri?: string;
  readonly rules: readonly SarifRule[];
};

export type SarifRun = { readonly tool: { readonly driver: SarifDriver }; readonly results: readonly SarifResult[] };

export type SarifLog = { readonly $schema: string; readonly version: string; readonly runs: readonly SarifRun[] };

export const parseSarif = (text: string): SarifLog => JSON.parse(text);
