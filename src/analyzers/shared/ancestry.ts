export type Ancestry<T> = { readonly chain: readonly T[]; readonly cyclic: boolean };

const extend = <T>(chain: readonly T[], current: T, parentOf: (node: T) => T | undefined): Ancestry<T> => {
  const parent = parentOf(current);
  if (parent === undefined) return { chain, cyclic: false };
  if (chain.includes(parent)) return { chain, cyclic: true };
  return extend([...chain, parent], parent, parentOf);
};

export const ancestry = <T>(start: T, parentOf: (node: T) => T | undefined): Ancestry<T> => extend([start], start, parentOf);
