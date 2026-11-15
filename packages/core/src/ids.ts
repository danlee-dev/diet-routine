// Deterministic UUIDs: the same (date, slot, kind) gives the same row id on every device,
// so checking a meal on the phone and on the desktop merges into one row instead of two.

function fnv1a(str: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** UUID-shaped (version 5 / RFC 4122 variant bits) id derived from a name. */
export function stableId(name: string): string {
  const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f].map((s) => fnv1a(name, s).toString(16).padStart(8, '0')).join('');
  const v = (parseInt(hex[16]!, 16) & 0x3) | 0x8;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${v.toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const mealCheckId = (date: string, slot: string): string => stableId(`meal-check:${date}:${slot}`);
