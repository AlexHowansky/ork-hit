/**
 * The four characteristics that are looked up rather than spent — SPD, DEX, INIT
 * and REC — on one line.
 *
 * These are the numbers a table reaches for without changing: SPD and DEX+INIT
 * decide where a character stands in the fight, and REC is what a Recovery is
 * worth. They are written the same way wherever they are read — a player's own
 * character panel and the game master's segment panel — so a game master looking
 * over a player's shoulder is reading the same line they are.
 *
 * The counterpart to `Vitals`, which is the other three: what a character has
 * left, and the only ones anybody edits mid-fight.
 *
 * One line, and it does not wrap. Four short pairs folded in half read at a
 * glance as two characters rather than one, so a screen too narrow to hold the
 * line cuts it short instead — REC is the least of the four to lose, which is
 * why it is last.
 */

import { HERO_STAT_LABELS } from "../../lib/hero.ts";
import { TEXT_MUTED } from "./ui.tsx";

export function StatLine({
  character,
  className = "",
}: {
  character: { speed: number; dexterity: number; initiative: number; recovery: number };
  className?: string;
}) {
  return (
    <p className={`truncate text-xs tabular-nums ${TEXT_MUTED} ${className}`}>
      {HERO_STAT_LABELS.speed} {character.speed} ·{" "}
      {HERO_STAT_LABELS.dexterity} {character.dexterity} ·{" "}
      {HERO_STAT_LABELS.initiative} {character.initiative} ·{" "}
      {HERO_STAT_LABELS.recovery} {character.recovery}
    </p>
  );
}
