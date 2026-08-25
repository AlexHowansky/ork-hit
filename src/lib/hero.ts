/**
 * The HERO System 5th Edition Revised characteristics this app tracks.
 *
 * One list, shared by the server and the client, because the same six names are
 * form field names, database columns, API fields and screen labels — and a
 * seventh place to add a characteristic is a place to forget one.
 *
 * The order is the order they are drawn in: the three looked-up characteristics
 * first, then the three that are spent during a fight.
 */
export const HERO_STAT_FIELDS = [
  "speed",
  "dexterity",
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
  recovery: "REC",
  endurance: "END",
  stun: "STUN",
  body: "BODY",
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
