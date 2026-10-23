import { DeclaredSuppression, DomainDeclaration } from '../engine/declaration';
import { classIdentity } from '../engine/class-identity';
import { RuleConfig, RuleSuppression } from '../rules/apply';

const ruleSuppression =
  (repositoryRoot: string, configLabel: string) =>
  (suppression: DeclaredSuppression): RuleSuppression => {
    const identity = classIdentity(suppression.target, repositoryRoot);
    return {
      rule: suppression.rule,
      classId: identity.id,
      target: identity.name,
      member: suppression.member,
      reason: suppression.reason,
      source: `${configLabel}:${suppression.line}`,
    };
  };

export const ruleConfigOf = (declaration: DomainDeclaration, repositoryRoot: string, configLabel: string): RuleConfig => ({
  levels: declaration.rules,
  suppressions: declaration.suppressions.map(ruleSuppression(repositoryRoot, configLabel)),
});
