import { isLibraryNode } from '../../shared/library';
import { ClassDeclaration, Node, Type } from 'ts-morph';
import { MAX_PROJECTION_DEPTH, ScalarProjection } from './model';

export const projectionReceiverType = (type: Type, projection: ScalarProjection): boolean => {
  const constituents = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  if (constituents.length > 0) return constituents.some(member => projectionReceiverType(member, projection));
  if (type.getConstructSignatures().length > 0) return false;
  const declarations = type.getSymbol()?.getDeclarations() ?? [];
  let cls: ClassDeclaration | undefined = projection.wrapper;
  for (let depth = 0; cls !== undefined && depth < MAX_PROJECTION_DEPTH; depth += 1, cls = cls.getBaseClass()) {
    if (declarations.includes(cls)) return cls === projection.wrapper || projection.wrapper.getType().isAssignableTo(type);
  }
  return false;
};

export class ProjectionRecords {
  private readonly cache = new Map<Type, boolean>();
  constructor(private readonly projection: ScalarProjection, private readonly aggregates: readonly ClassDeclaration[]) {}
  contains(type: Type, at: Node): boolean {
    const cached = this.cache.get(type);
    if (cached !== undefined) return cached;
    const result = this.visit(type, at, new Set(), { left: 256 });
    this.cache.set(type, result);
    return result;
  }
  private visit(type: Type, at: Node, seen: Set<Type>, budget: { left: number }): boolean {
    if (seen.has(type)) return false;
    if (budget.left-- <= 0) return true;
    seen.add(type);
    if (projectionReceiverType(type, this.projection)) return true;
    const constituents = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
    if (constituents.length > 0) return constituents.some(member => this.visit(member, at, seen, budget));
    if (!type.isObject() || type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false;
    const declarations = type.getSymbol()?.getDeclarations() ?? [];
    if (declarations.some(declaration => Node.isClassDeclaration(declaration) && this.aggregates.includes(declaration))) return false;
    const parameters = [...type.getTypeArguments(), ...type.getAliasTypeArguments()];
    if (parameters.some(parameter => this.visit(parameter, at, seen, budget))) return true;
    const properties = type.getProperties();
    if (properties.some(property => projectionReceiverType(property.getTypeAtLocation(at), this.projection))) return true;
    if (declarations.length > 0 && declarations.every(isLibraryNode)) return false;
    return properties.some(property => this.visit(property.getTypeAtLocation(at), at, seen, budget));
  }
}
