/**
 * Tiny classname joiner. Deliberately not `clsx` + `tailwind-merge` — this app
 * is small enough that conflicting classes are a code-review problem, not a
 * runtime one.
 */
export type ClassValue = string | number | null | false | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
