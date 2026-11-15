import { unwrap } from '../../shared/wrappers';
import { Node, Type } from 'ts-morph';
import { ScalarProjection } from './model';
import { ProjectionRecords } from './receiver-types';

const selectedInstance = (type: Type, projection: ScalarProjection): boolean =>
  type.getConstructSignatures().length === 0 && type.getSymbol()?.getDeclarations().includes(projection.wrapper) === true;

export class ProjectionFlows {
  private readonly records: ProjectionRecords;
  constructor(private readonly projection: ScalarProjection) { this.records = new ProjectionRecords(projection, []); }
  mismatches(actual: Type, expected: Type, at: Node): boolean {
    return this.compare(actual, expected, at, new Map(), { left: 256 });
  }
  private compare(actual: Type, expected: Type, at: Node, seen: Map<Type, Set<Type>>, budget: { left: number }): boolean {
    if (actual === expected || seen.get(expected)?.has(actual) || !this.records.contains(expected, at)) return false;
    if (budget.left-- <= 0) return true;
    seen.set(expected, new Set([...(seen.get(expected) ?? []), actual]));
    const alternatives = [...expected.getUnionTypes(), ...expected.getIntersectionTypes()];
    if ((actual.isNull() && alternatives.some(member => member.isNull())) || (actual.isUndefined() && alternatives.some(member => member.isUndefined()))) return false;
    if (alternatives.length > 0) return alternatives.some(member => this.compare(actual, member, at, seen, budget));
    const actualAlternatives = [...actual.getUnionTypes(), ...actual.getIntersectionTypes()];
    if (actualAlternatives.length > 0) return actualAlternatives.some(member => this.compare(member, expected, at, seen, budget));
    if (selectedInstance(expected, this.projection)) return !selectedInstance(actual, this.projection);
    if (actual.isNull() || actual.isUndefined() || Node.isNullLiteral(unwrap(at))) return false;
    const actualClass = actual.getSymbol()?.getDeclarations();
    const expectedClass = expected.getSymbol()?.getDeclarations();
    if (actualClass?.length === 1 && expectedClass?.length === 1 && actualClass[0] === expectedClass[0] &&
        Node.isClassDeclaration(actualClass[0]) && actualClass[0].getTypeParameters().length === 0) return false;
    const element = expected.getArrayElementType();
    if (element !== undefined && this.records.contains(element, at)) {
      const source = actual.getArrayElementType();
      return source === undefined || this.compare(source, element, at, seen, budget);
    }
    return expected.getProperties().some(property => {
      const target = property.getTypeAtLocation(at);
      if (!this.records.contains(target, at)) return false;
      const source = actual.getProperty(property.getName());
      if (source === undefined) return !property.isOptional();
      const initializer = source.getDeclarations().find(declaration => Node.isPropertyAssignment(declaration) && declaration.getParent() === at);
      const value = Node.isPropertyAssignment(initializer) ? unwrap(initializer.getInitializerOrThrow()) : undefined;
      return this.compare(value?.getType() ?? source.getTypeAtLocation(at), target, value ?? at, seen, budget);
    });
  }
}
