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
  "constitution",
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
  constitution: "CON",
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

/* ------------------------------------------------------------- status tags */

/**
 * The conditions a character can be in during a fight, as they are stored.
 *
 * These are the ones the app knows by name: each has a label and, on the client,
 * a picture. Anything else a table wants to track is a **custom tag** — the text
 * somebody typed, kept as they typed it — so this list is the vocabulary the app
 * draws rather than the whole of what may be written.
 *
 * Alphabetical, and drawn in this order wherever more than one is showing, so a
 * row's badges do not reshuffle when another is added.
 *
 * No pictures anywhere: a condition is drawn as its word, on the pills and on
 * the buttons that set them alike. See `src/client/components/StatusTags.tsx`.
 */
export const STATUS_TAGS = [
  "dead",
  "drained",
  "entangled",
  "flashed",
  "prone",
  "sleeping",
  "stunned",
  "suppressed",
  "unconscious",
] as const;

export type StatusTag = (typeof STATUS_TAGS)[number];

/** What each one is called on screen. */
export const STATUS_TAG_LABELS: Record<StatusTag, string> = {
  dead: "Dead",
  drained: "Drained",
  entangled: "Entangled",
  flashed: "Flashed",
  prone: "Prone",
  sleeping: "Sleeping",
  stunned: "Stunned",
  suppressed: "Suppressed",
  unconscious: "Unconscious",
};

/**
 * Hover text for the ones whose name does not say the whole of it. A tag missing
 * from here is drawn with its label alone rather than with an empty tooltip.
 */
export const STATUS_TAG_HINTS: Partial<Record<StatusTag, string>> = {
  drained: "A characteristic has been reduced by a Drain.",
  flashed: "Blinded to a sense group by a Flash.",
  suppressed: "A power is being held down by a Suppress.",
};

/** How long a typed tag may be. A pill wider than this wrecks the row it is on. */
export const STATUS_TAG_MAX_LENGTH = 24;

/** Whether a stored tag is one the app knows by name, rather than a typed one. */
export function isKnownTag(tag: string): tag is StatusTag {
  return (STATUS_TAGS as readonly string[]).includes(tag);
}

/**
 * What a tag is called wherever it is shown or written down.
 *
 * The nine are stored in the lower case the buttons send and read back in the
 * case a person would write them; a typed one is already whatever the table
 * wrote, and is left alone. Here rather than in the browser because the log
 * lines the server composes have to call a condition what the badge beside them
 * calls it.
 */
export function tagLabel(tag: string): string {
  return isKnownTag(tag) ? STATUS_TAG_LABELS[tag] : tag;
}

/**
 * How a condition is marked inside a log line.
 *
 * A log event is one sentence, stored as it will be read — that is the whole of
 * migration 008's reasoning, and it is why a line about a character renamed
 * afterwards still says what it said. But the log draws a condition as the same
 * pill the character's row does, and to do that it has to know which words of
 * the sentence are the condition.
 *
 * So the tag is wrapped where the sentence is composed. Braces rather than
 * something invisible: a message read straight out of the database is still a
 * sentence a person can read, and `added {Prone} to Goblin 2` explains itself.
 * A brace typed into a tag is dropped from the marked copy, since a nested pair
 * would leave the reader below guessing where the pill ends.
 */
export function markTag(label: string): string {
  return `{${label.replaceAll(/[{}]/g, "")}}`;
}

/**
 * A marked-up line, split into what to draw plainly and what to draw as a pill.
 *
 * Every other event has no marks in it and comes back as one plain piece, so a
 * caller can run this over the whole log without asking which kind each line is.
 */
export function splitMarkedTags(message: string): { text: string; isTag: boolean }[] {
  return message
    .split(/(\{[^{}]*\})/g)
    .filter((piece) => piece !== "")
    .map((piece) => (
      piece.startsWith("{") && piece.endsWith("}")
        ? { text: piece.slice(1, -1), isTag: true }
        : { text: piece, isTag: false }
    ));
}

/**
 * Tidies a tag on its way in: the outer spaces go, a run of inner space becomes
 * one, and anything that spells one of the nine — in whatever case it was typed
 * — becomes that one.
 *
 * That last part is the point of the function. "Prone" typed into the box is the
 * same condition as the Prone button, and a table that ended up with both would
 * have two prone characters that agree about nothing.
 */
export function normalizeTag(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const lowered = trimmed.toLowerCase();
  return isKnownTag(lowered) ? lowered : trimmed;
}

/**
 * Sorts a slot's tags for display: the ones the app knows by name first, in the
 * order `STATUS_TAGS` gives them, then whatever was typed, alphabetically. The
 * order a tag was applied in says nothing, and a list that rearranged itself as
 * conditions came and went would have to be re-read every time.
 */
export function sortTags(tags: string[]): string[] {
  const rank = (tag: string) =>
    isKnownTag(tag) ? STATUS_TAGS.indexOf(tag) : STATUS_TAGS.length;
  return [...tags].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/* ------------------------------------------------------------ the speed chart */

/** A HERO Turn is twelve segments long, and always has been. */
export const SEGMENTS_PER_TURN = 12;

/**
 * Where a fight starts.
 *
 * HERO opens combat on Segment 12 rather than Segment 1, which is why a session
 * begins on Turn 1 Segment 12 and the first Segment 1 anyone sees belongs to
 * Turn 2. It reads as an off-by-one and is not one.
 */
export const OPENING_SEGMENT = 12;

/**
 * What the table is told when the clock crosses Segment 12 and everybody on the
 * stage takes their free Recovery.
 *
 * The rule's own name, because that is what a player will look up: HERO calls it
 * the Post-Segment 12 Recovery, and a toast reading "Everyone recovers" would
 * leave them hunting for it.
 */
export const POST_SEGMENT_12_NOTICE = "Post-Segment 12 Recovery";

/**
 * The Speed Chart: which of the twelve segments a character acts in, by SPD.
 *
 * Indexed by SPD, so `SPEED_CHART[5]` is what a SPD 5 character gets. SPD 0 is
 * the empty list and means exactly what it says — a character nobody has filled
 * in has no phases, and never comes up on turn. `HERO_STAT_RANGES.speed` is what
 * keeps the index inside this array on the way in; `segmentsFor` clamps anyway,
 * because a stored number that predates that bound would otherwise read as
 * `undefined` under `noUncheckedIndexedAccess`.
 */
export const SPEED_CHART: readonly (readonly number[])[] = [
  [],
  [7],
  [6, 12],
  [4, 8, 12],
  [3, 6, 9, 12],
  [3, 5, 8, 10, 12],
  [2, 4, 6, 8, 10, 12],
  [2, 4, 6, 7, 9, 11, 12],
  [2, 3, 5, 6, 8, 9, 11, 12],
  [2, 3, 4, 6, 7, 8, 10, 11, 12],
  [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
];

/** The segments a SPD acts in, ascending. Out-of-range SPDs clamp into the chart. */
export function segmentsFor(speed: number): readonly number[] {
  const clamped = Math.min(Math.max(Math.trunc(speed), 0), SEGMENTS_PER_TURN);
  return SPEED_CHART[clamped]!;
}

/** Whether a SPD acts in a given segment. The chart read the other way round. */
export function actsIn(speed: number, segment: number): boolean {
  return segmentsFor(speed).includes(segment);
}

/**
 * How a character is placed against the others acting in the same segment:
 * highest first.
 *
 * DEX is the order HERO runs a segment in, and INITIATIVE is the bonus on top of
 * it that DEX does not explain. Summed in one place so "DEX+INIT" means the same
 * thing in the query that sorts the stage and in any screen that says so.
 */
export function initiativeRank(character: { dexterity: number; initiative: number }): number {
  return character.dexterity + character.initiative;
}
