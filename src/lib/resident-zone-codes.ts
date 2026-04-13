/**
 * Boendeparkering zone letters (WFS `boende`); must match imported `taxa_name` prefix `Boende {letter}`.
 */
export const RESIDENT_ZONE_CODES = ["C", "G", "H", "K", "L", "M", "S", "V", "Ä", "Ö"] as const;

export type ResidentZoneCode = (typeof RESIDENT_ZONE_CODES)[number];

export function isValidResidentZoneCode(raw: string): boolean {
  const z = raw.trim();
  return (RESIDENT_ZONE_CODES as readonly string[]).includes(z);
}
