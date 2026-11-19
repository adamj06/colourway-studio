// Total accessors for `noUncheckedIndexedAccess`: an out-of-range index or a missing regex group is '' rather
// than undefined, so parsers need no scattered fallbacks.

export const at = (items: readonly string[], index: number): string => items[index] ?? '';

export const group = (match: RegExpExecArray | null | undefined, index: number): string => match?.[index] ?? '';
