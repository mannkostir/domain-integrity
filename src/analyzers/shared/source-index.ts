import {
  KindToNodeMappings,
  NoSubstitutionTemplateLiteral,
  NumericLiteral,
  PropertyAccessExpression,
  SourceFile,
  StringLiteral,
  SyntaxKind,
} from 'ts-morph';
import { groupedBy } from './grouping';

type Grouping<T> = ReadonlyMap<string, readonly T[]>;

type TextLiteral = StringLiteral | NoSubstitutionTemplateLiteral;

type ValueLiteral = StringLiteral | NumericLiteral | NoSubstitutionTemplateLiteral;

export class SourceIndex {
  private readonly byKind = new Map<SyntaxKind, readonly unknown[]>();
  private textLiterals: Grouping<TextLiteral> | undefined;
  private valueLiterals: Grouping<ValueLiteral> | undefined;
  private propertyAccesses: Grouping<PropertyAccessExpression> | undefined;

  constructor(readonly files: readonly SourceFile[]) {}

  ofKind<K extends SyntaxKind>(kind: K): readonly KindToNodeMappings[K][] {
    const known = this.byKind.get(kind);
    if (known !== undefined) return known as readonly KindToNodeMappings[K][];
    const nodes = this.files.flatMap((file) => file.getDescendantsOfKind(kind));
    this.byKind.set(kind, nodes);
    return nodes;
  }

  literalsWithText(text: string): readonly TextLiteral[] {
    this.textLiterals ??= groupedBy(
      [...this.ofKind(SyntaxKind.StringLiteral), ...this.ofKind(SyntaxKind.NoSubstitutionTemplateLiteral)],
      (literal) => [literal.getLiteralText()],
    );
    return this.textLiterals.get(text) ?? [];
  }

  literalsWithValue(value: string): readonly ValueLiteral[] {
    this.valueLiterals ??= groupedBy(
      [
        ...this.ofKind(SyntaxKind.StringLiteral),
        ...this.ofKind(SyntaxKind.NumericLiteral),
        ...this.ofKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ],
      (literal) => [String(literal.getLiteralValue())],
    );
    return this.valueLiterals.get(value) ?? [];
  }

  propertyAccessesNamed(name: string): readonly PropertyAccessExpression[] {
    this.propertyAccesses ??= groupedBy(this.ofKind(SyntaxKind.PropertyAccessExpression), (access) => [access.getName()]);
    return this.propertyAccesses.get(name) ?? [];
  }
}
