/**
 * The HERO System 5th Edition Revised characteristics this app tracks.
 *
 * One list, shared by the server and the client, because the same names are
 * form field names, database columns, API fields and screen labels — and a
 * second place to add a characteristic is a place to forget one.
 *
 * The order is the order they are drawn in: the looked-up characteristics
 * first, then the three that are spent during a fight.
 */
export const HERO_STAT_FIELDS = [
  "speed",
  "dexterity",
  "initiative",
  "recovery",
  "endurance",
  "stun",
  "body",
] as const;

export type HeroStatField = (typeof HERO_STAT_FIELDS)[number];

/** What each one is called on screen: HERO writes them in capitals. */
export const HERO_STAT_LABELS: Record<HeroStatField, string> = {
  speed: "SPD",
  dexterity: "DEX",
  initiative: "INIT",
  recovery: "REC",
  endurance: "END",
  stun: "STUN",
  body: "BODY",
};

/**
 * Hover text for the characteristics that do not explain themselves.
 *
 * Most need nothing: SPD and STUN are what the sheet calls them, and a game
 * master reading a form knows them already. A field missing from here is drawn
 * without a tooltip rather than with an empty one.
 */
export const HERO_STAT_HINTS: Partial<Record<HeroStatField, string>> = {
  initiative: "Any non-DEX initiative bonus. E.g., the Combat reflexes talent.",
};

/**
 * The range a characteristic is allowed to take in the character editor, for
 * the ones the rules bound.
 *
 * SPEED is the only one so far: HERO runs a turn on twelve segments, so a SPD
 * above 12 is not a fast character but a typo, and a negative one is nobody at
 * all. The rest are left unbounded here — a STUN total has no ceiling worth
 * writing down — and fall back to the wide sanity range `schemas.heroStat`
 * applies on the way in.
 *
 * One map, read twice: the editor draws its inputs `min` and `max` from it, and
 * `schemas.heroStat` builds the same bound into the schema the server parses
 * with. The browser's copy is the courtesy; the schema is what is enforced.
 *
 * A field missing from here is drawn without `min` or `max`.
 */
export const HERO_STAT_RANGES: Partial<Record<HeroStatField, { min: number; max: number }>> = {
  speed: { min: 0, max: 12 },
};

/**
 * The three that a copy of a character spends during play, and so are tracked
 * per stage slot as well as on the character.
 */
export const HERO_VITAL_FIELDS = ["endurance", "stun", "body"] as const;

export type HeroVitalField = (typeof HERO_VITAL_FIELDS)[number];

/**
 * How healthy one of the spendable characteristics is, as a band rather than a
 * colour: under a third left is `"low"`, up to two thirds `"middling"`, above
 * that `"full"`.
 *
 * `"unknown"` is nought out of nought — a character nobody has filled in yet,
 * where there is no reading to give rather than a good or a bad one.
 *
 * The rule lives here, with the characteristics themselves, so the screens are
 * left deciding only what each band looks like.
 */
export type VitalBand = "low" | "middling" | "full" | "unknown";

export function bandFor(current: number, max: number): VitalBand {
  if (max <= 0) return "unknown";
  const share = (current / max) * 100;
  if (share < 33) return "low";
  if (share <= 67) return "middling";
  return "full";
}
