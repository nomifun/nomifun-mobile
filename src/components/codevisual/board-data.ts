export function partitionBoard<T, K extends string>(
  items: readonly T[],
  lanes: readonly { key: K; title: string; danger?: boolean }[],
  keyOf: (item: T) => K,
) {
  return lanes.map((lane) => ({
    ...lane,
    items: items.filter((item) => keyOf(item) === lane.key),
  }));
}
