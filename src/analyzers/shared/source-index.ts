import {
  KindToNodeMappings,
  Node,
  NoSubstitutionTemplateLiteral,
  NumericLiteral,
  PropertyAccessExpression,
  SourceFile,
  StringLiteral,
  SyntaxKind,
} from 'ts-morph';

type Grouping<T> = ReadonlyMap<string, readonly T[]>;

type TextLiteral = StringLiteral | NoSubstitutionTemplateLiteral;

type ValueLiteral = StringLiteral | NumericLiteral | NoSubstitutionTemplateLiteral;

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Grouping<T> => {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  });
  return groups;
};

export class SourceIndex {
  private readonly fileOrder: ReadonlyMap<SourceFile, number>;
  private readonly byKind = new Map<SyntaxKind, readonly unknown[]>();
  private textLiterals: Grouping<TextLiteral> | undefined;
  private valueLiterals: Grouping<ValueLiteral> | undefined;
  private propertyAccesses: Grouping<PropertyAccessExpression> | undefined;

  constructor(readonly files: readonly SourceFile[]) {
    this.fileOrder = new Map(files.map((file, order) => [file, order]));
  }

  ofKind<K extends SyntaxKind>(kind: K): readonly KindToNodeMappings[K][] {
    const known = this.byKind.get(kind);
    if (known !== undefined) return known as readonly KindToNodeMappings[K][];
    const nodes = this.files.flatMap((file) => file.getDescendantsOfKind(kind));
    this.byKind.set(kind, nodes);
    return nodes;
  }

  private readonly byPosition = (first: Node, second: Node): number =>
    (this.fileOrder.get(first.getSourceFile()) ?? 0) - (this.fileOrder.get(second.getSourceFile()) ?? 0) || first.getPos() - second.getPos();

  literalsWithText(text: string): readonly TextLiteral[] {
    this.textLiterals ??= groupBy(
      [...this.ofKind(SyntaxKind.StringLiteral), ...this.ofKind(SyntaxKind.NoSubstitutionTemplateLiteral)].sort(this.byPosition),
      (literal) => literal.getLiteralText(),
    );
    return this.textLiterals.get(text) ?? [];
  }

  literalsWithValue(value: string): readonly ValueLiteral[] {
    this.valueLiterals ??= groupBy(
      [
        ...this.ofKind(SyntaxKind.StringLiteral),
        ...this.ofKind(SyntaxKind.NumericLiteral),
        ...this.ofKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ].sort(this.byPosition),
      (literal) => String(literal.getLiteralValue()),
    );
    return this.valueLiterals.get(value) ?? [];
  }

  propertyAccessesNamed(name: string): readonly PropertyAccessExpression[] {
    this.propertyAccesses ??= groupBy(this.ofKind(SyntaxKind.PropertyAccessExpression), (access) => access.getName());
    return this.propertyAccesses.get(name) ?? [];
  }
}
