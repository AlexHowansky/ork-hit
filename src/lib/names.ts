/**
 * How this app puts names in order.
 *
 * A shelf of cards is read by running an eye down it, and an eye looks for the
 * word the name is *about*. "The Crimson Fist" files under C, the way a library
 * catalogue and a record shop both file it — leave the article in and half a
 * campaign's cast collects under T, which is no order at all for finding
 * anything.
 *
 * One rule, shared: the server sends the library already in order and the browser
 * has to file a newly uploaded character into that same order without asking for
 * the list again, so a second definition is a list that reshuffles itself on the
 * next reload.
 *
 * That sharing is also why the rule lives in TypeScript rather than in the
 * `ORDER BY` it used to be. SQLite can be taught a collation by a host program,
 * but `bun:sqlite` exposes no way to register one — so a name rule written in SQL
 * could only ever be a second copy of this one, written in a language that cannot
 * be made to agree with it.
 */

/**
 * The article that is not part of a name for filing purposes.
 *
 * The trailing whitespace is the whole of what keeps `Theodore` and `Thelonious`
 * out of it: this is a word, not a prefix. And only the leading one — "Sword of
 * the Morning" files under S, and the article inside it is part of the name.
 *
 * Just the definite article. "A Friend" and "An Old Enemy" are names somebody
 * chose to begin that way rather than the grammar of a title, and a table that
 * wanted them filed under F and O can say so by typing them that way.
 */
const LEADING_ARTICLE = /^the\s+/iu;

/** What a name files under: the name itself, less any article in front of it. */
export function nameSortKey(name: string): string {
  return name.replace(LEADING_ARTICLE, "");
}

/**
 * Two names in the order they should be read in.
 *
 * `sensitivity: "base"` so that case and accents do not decide the order — a
 * reader looking for "elara" does not think of it as a different word from
 * "Elara". It is the browser's nearest equivalent to the `COLLATE NOCASE` the
 * database used to sort these with.
 *
 * The full name breaks a tie, so "Ravager" and "The Ravager" land in a fixed
 * order rather than in whichever order they happened to arrive in — the same
 * list has to come out the same way twice.
 */
export function compareNames(a: string, b: string): number {
  const collated = (x: string, y: string) =>
    x.localeCompare(y, undefined, { sensitivity: "base" });
  return collated(nameSortKey(a), nameSortKey(b)) || collated(a, b);
}
