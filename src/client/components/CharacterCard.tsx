/** A character in the library, presented as a card with its background image. */

import type { HTMLAttributes, ReactNode } from "react";
import { faDragon, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import type { Character } from "../types.ts";
import {
  CARD_CAPTION,
  CARD_NAME,
  CardPicture,
  CardWell,
  HoverCard,
  KindBadge,
} from "./ui.tsx";

export function CharacterCard({
  character,
  actions,
  onOpen,
  dragProps,
}: {
  character: Character;
  actions?: ReactNode;
  onOpen?: () => void;
  /** Makes the card something that can be picked up — see `GmLibrary`. */
  dragProps?: HTMLAttributes<HTMLElement> & { draggable?: boolean };
}) {
  return (
    // The whole card opens the character, rather than the name under it doing so:
    // `HoverCard`'s zones cover the name, and the card's one obvious action is
    // better as the card than as a word inside it. The label is the character's
    // name alone, since the name it would otherwise take is everything printed on
    // the tile — the kind badge included.
    <HoverCard
      {...dragProps}
      label={onOpen ? character.name : undefined}
      onClick={onOpen}
      actions={actions}
      cardClassName="border-base-300 bg-base-100"
    >
      <CardWell>
        <CardPicture
          src={character.backgroundUrl}
          icon={character.kind === "pc" ? faShieldHalved : faDragon}
          draggable={false}
        />
        <div className="absolute top-2 left-2">
          <KindBadge kind={character.kind} />
        </div>
      </CardWell>

      <div className={CARD_CAPTION}>
        <h3 className={CARD_NAME}>{character.name}</h3>
      </div>
    </HoverCard>
  );
}
