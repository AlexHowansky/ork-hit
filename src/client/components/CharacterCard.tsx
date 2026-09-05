/** A character in the library, presented as a card with its card image. */

import type { HTMLAttributes, ReactNode } from "react";
import { faDragon, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { HERO_STAT_FIELDS, HERO_STAT_LABELS, type HeroStatField } from "../../lib/hero.ts";
import type { Character } from "../types.ts";
import {
  CARD_CAPTION_FRAMED,
  CARD_NAME,
  CARD_WINDOW,
  CardFrame,
  CardPicture,
  CardWell,
  type DropProps,
  HoverCard,
} from "./ui.tsx";

/**
 * What is printed on the back of a card, in the order it is read.
 *
 * All seven of them: where the character stands in the fight (SPD, DEX, INIT),
 * what a Recovery is worth (REC), and the three totals a session then counts
 * down from (END, STUN, BODY). `HERO_STAT_FIELDS` is already in this order and
 * is the list, so a characteristic added there appears here without being added
 * twice — which is the whole point of that list existing.
 */
const BACK_STATS: readonly HeroStatField[] = HERO_STAT_FIELDS;

/**
 * The back of a character's card: the same stock, with the numbers where the
 * picture was.
 *
 * Printed in the same frame as the front — the card has not become a different
 * card by being turned over — with the name in the strip it always sits in, so a
 * face-down library is still readable as a library. Which leaves the window, and
 * the window holds the stat block.
 *
 * `data-theme="winter"` for the whole face, and for the reason the name's strip
 * carries it on the front (see `CARD_CAPTION_FRAMED`): the frame is one cut for
 * both themes, so the back of a card is pale whatever the page is doing, and the
 * ink on it has to be the ink that belongs on pale card. daisyUI answers the
 * attribute with the light theme's whole palette scoped here, so nothing below
 * names a colour — they go on asking for `base-content` and get the right one.
 */
function CharacterCardBack({ character }: { character: Character }) {
  return (
    <div className="relative h-full w-full bg-base-100" data-theme="winter">
      {/* The stock the numbers are printed on: the same full-width square the
          front prints its picture in, so the back is printed edge to edge and
          the frame trims it. Laid out rather than positioned, for exactly the
          reason the front's well is — see `.card-back-art` in `styles.css`. */}
      <div className="card-back-art aspect-square w-full shrink-0" aria-hidden />

      <CardFrame kind={character.kind} />

      {/* Laid in the frame's window, where the front's picture shows through.
          The rows are spread down it rather than stacked from the top: the
          window is a fixed share of the card at every size, so a block centred
          in it stays centred whether the cards are drawn at 100px or 350px. */}
      <dl
        className={
          // Set exactly as the name below it is: the same face, the same weight
          // and the same ink at full strength (`CARD_NAME`). A label held back at
          // half opacity read as a caption on a screen rather than as something
          // printed, and a card has no captions on it — both halves of a row are
          // printed matter.
          `card-stat absolute z-20 flex flex-col justify-evenly px-[6%] font-medium `
          + `tabular-nums ${CARD_WINDOW}`
        }
      >
        {BACK_STATS.map((field) => (
          // A rule under each pair, in the way a printed stat block is ruled —
          // and none under the last, which would be a line across the bottom of
          // the window rather than a divider between two things.
          <div
            key={field}
            className="flex items-baseline justify-between gap-2 border-b border-base-content/15 last:border-b-0"
          >
            <dt>{HERO_STAT_LABELS[field]}</dt>
            <dd>{character[field]}</dd>
          </div>
        ))}
      </dl>

      {/* The name, in the panel the frame paints, exactly as on the front. */}
      <div className={CARD_CAPTION_FRAMED}>
        <h3 className={CARD_NAME}>{character.name}</h3>
      </div>
    </div>
  );
}

export function CharacterCard({
  character,
  actions,
  onOpen,
  dragProps,
  dropProps,
  inviting = false,
  flippable = false,
  flipped = false,
  onAttention,
}: {
  character: Character;
  actions?: ReactNode;
  onOpen?: () => void;
  /** Makes the card something that can be picked up — see `GmLibrary`. */
  dragProps?: HTMLAttributes<HTMLElement> & { draggable?: boolean };
  /** Makes it something a picture can be dropped on — also `GmLibrary`. */
  dropProps?: DropProps;
  /** A picture is over the card now, so the well says where it would land. */
  inviting?: boolean;
  /**
   * Whether the card has a back to be turned over to. Only the library gives it
   * one: on the session screens the numbers are already on the screen beside the
   * card, and a card that turned over there would be hiding the picture to say
   * something that is said twice already.
   */
  flippable?: boolean;
  /** Whether the back is the side showing. Ignored unless `flippable`. */
  flipped?: boolean;
  /**
   * The card has come under the reader's attention, or lost it: the pointer has
   * moved onto it, or the keyboard has focused something inside it.
   *
   * Which is one thing rather than two, because what asks for it is one thing —
   * the library's hot keys, which change a character's kind and need to know
   * which character is meant. A game master driving the page by keyboard has no
   * pointer to hover with, and the card they are on is the card they mean.
   */
  onAttention?: (attending: boolean) => void;
}) {
  const attention = onAttention
    ? {
        onMouseEnter: () => onAttention(true),
        onMouseLeave: () => onAttention(false),
        // `focus` and `blur` on a React element are the bubbling pair, so these
        // hear about the card's own button and its corner controls alike. Moving
        // between two of them fires the leaving half before the arriving one, so
        // the card is still attended to at the end of it.
        onFocus: () => onAttention(true),
        onBlur: () => onAttention(false),
      }
    : undefined;

  return (
    // The whole card opens the character, rather than the name under it doing so:
    // `HoverCard`'s zones cover the name, and the card's one obvious action is
    // better as the card than as a word inside it. The label is the character's
    // name alone, since the name it would otherwise take is everything printed on
    // the tile.
    <HoverCard
      {...dragProps}
      {...dropProps}
      {...attention}
      label={onOpen ? character.name : undefined}
      onClick={onOpen}
      // Which side is up, said out loud: a card is a toggle once it has a back,
      // and a reader who cannot see it turn is otherwise told nothing by the
      // press. Without a back there is no state to report and this stays unset.
      pressed={flippable ? flipped : undefined}
      actions={actions}
      back={flippable ? <CharacterCardBack character={character} /> : undefined}
      flipped={flipped}
      cardClassName="border-base-300 bg-base-100"
    >
      {/* Foil is a player character's; an NPC's card is plain stock. */}
      <CardWell foil={character.kind === "pc"} inviting={inviting}>
        <CardPicture
          src={character.cardUrl}
          icon={character.kind === "pc" ? faShieldHalved : faDragon}
          draggable={false}
        />
      </CardWell>

      {/* Over the picture, under the name: the picture shows through the frame's
          window and the name is drawn on the panel the frame paints. A PC and an
          NPC are printed in different cuts of it. */}
      <CardFrame kind={character.kind} />

      {/* The panel under the name is pale in both themes, so the strip carries
          the light theme rather than the page's — see `CARD_CAPTION_FRAMED`. */}
      <div className={CARD_CAPTION_FRAMED} data-theme="winter">
        <h3 className={CARD_NAME}>{character.name}</h3>
      </div>
    </HoverCard>
  );
}
