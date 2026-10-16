export function filterPaletteGroups<T extends { label: string }>(
  groups: readonly { label: string; items: T[] }[],
  query: string,
): { label: string; items: T[] }[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        terms.every((term) => item.label.toLocaleLowerCase().includes(term)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

export function nextCommandIndex(current: number, delta: number, count: number) {
  return count === 0 ? 0 : (((current + delta) % count) + count) % count;
}
