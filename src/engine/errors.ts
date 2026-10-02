export class DomainIntegrityError extends Error {
  readonly exitCode: number = 2;
}

export class ConfigError extends DomainIntegrityError {
  override readonly name = 'ConfigError';
}

export class ProjectError extends DomainIntegrityError {
  override readonly name = 'ProjectError';
}

export class UsageError extends DomainIntegrityError {
  override readonly name = 'UsageError';
}
