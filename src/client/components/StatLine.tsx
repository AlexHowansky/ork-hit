/**
 * The five characteristics that are looked up rather than spent — SPD, DEX, INIT,
 * CON and REC — on one line.
 *
 * These are the numbers a table reaches for without changing: SPD and DEX+INIT
 * decide where a character stands in the fight, CON is what a stunning hit is
 * measured against, and REC is what a Recovery is worth. They are written the
 * same way wherever they are read — a player's own character panel and the game
 * master's segment panel — so a game master looking over a player's shoulder is
 * reading the same line they are.
 *
 * The counterpart to `Vitals`, which is the other three: what a character has
 * left, and the only ones anybody edits mid-fight.
 *
 * One line, and it does not wrap. Five short pairs folded in half read at a
 * glance as two characters rather than one, so a screen too narrow to hold the
 * line cuts it short instead — REC is the least of the five to lose, which is
 * why it is still last.
 */

import { HERO_STAT_LABELS } from "../../lib/hero.ts";
import { PANEL_CAPTION } from "./ui.tsx";

export function StatLine({
  character,
  className = "",
}: {
  character: {
    speed: number;
    dexterity: number;
    initiative: number;
    constitution: number;
    recovery: number;
  };
  className?: string;
}) {
  return (
    // Set like the captions on the line of numbers below it — same size, weight
    // and letter-spacing — so a row reads as one block of small print under the
    // name rather than as two lines that were styled apart.
    <p className={`truncate text-xs tabular-nums ${PANEL_CAPTION} ${className}`}>
      {HERO_STAT_LABELS.speed} {character.speed} ·{" "}
      {HERO_STAT_LABELS.dexterity} {character.dexterity} ·{" "}
      {HERO_STAT_LABELS.initiative} {character.initiative} ·{" "}
      {HERO_STAT_LABELS.constitution} {character.constitution} ·{" "}
      {HERO_STAT_LABELS.recovery} {character.recovery}
    </p>
  );
}
