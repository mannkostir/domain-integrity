const LABEL_ESCAPES: Readonly<Record<string, string>> = { '#': '#35;', '"': '#quot;', ';': '#59;' };

export const escapeLabel = (label: string): string => label.replace(/[#";]/g, (character) => LABEL_ESCAPES[character] ?? character);
