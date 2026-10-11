export const groupedBy = <K, T>(items: readonly T[], keysOf: (item: T) => readonly K[]): ReadonlyMap<K, readonly T[]> => {
  const groups = new Map<K, T[]>();
  items.forEach((item) =>
    keysOf(item).forEach((key) => {
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [item]);
      else group.push(item);
    }),
  );
  return groups;
};
