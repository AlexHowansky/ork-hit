/** A character in the library, presented as a card with its card image. */

import type { HTMLAttributes, ReactNode } from "react";
import { faDragon, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import type { Character } from "../types.ts";
import {
  CARD_CAPTION_FRAMED,
  CARD_NAME,
  CardFrame,
  CardPicture,
  CardWell,
  type DropProps,
  HoverCard,
} from "./ui.tsx";

export function CharacterCard({
  character,
  actions,
  onOpen,
  dragProps,
  dropProps,
  inviting = false,
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
}) {
  return (
    // The whole card opens the character, rather than the name under it doing so:
    // `HoverCard`'s zones cover the name, and the card's one obvious action is
    // better as the card than as a word inside it. The label is the character's
    // name alone, since the name it would otherwise take is everything printed on
    // the tile.
    <HoverCard
      {...dragProps}
      {...dropProps}
      label={onOpen ? character.name : undefined}
      onClick={onOpen}
      actions={actions}
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
