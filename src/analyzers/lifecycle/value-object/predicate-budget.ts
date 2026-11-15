import { MAX_PREDICATE_DEPTH, MAX_PREDICATE_WORK } from './predicate-model';

export class PredicateBudget {
  private remaining = MAX_PREDICATE_WORK;

  take(depth = 0): boolean {
    if (depth > MAX_PREDICATE_DEPTH || this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}
