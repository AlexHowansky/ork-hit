/** A character in the library, presented as a card with its background image. */

import type { HTMLAttributes, ReactNode } from "react";
import { faDragon, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import type { Character } from "../types.ts";
import {
  CARD_CAPTION_FRAMED,
  CARD_NAME,
  CardFrame,
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
      </CardWell>

      {/* Over the picture, under the name: the picture shows through the frame's
          window and the name is drawn on the panel the frame paints. */}
      <CardFrame />

      <div className={CARD_CAPTION_FRAMED}>
        <h3 className={CARD_NAME}>{character.name}</h3>
        {/* On the name panel rather than over the picture, tucked as far into its
            upper right as the artwork allows. Measured off the asset, and measured
            carefully, because the panel has a decorative outline inset well within
            it that is easy to mistake for its edge: the panel's own surface runs
            out to x=96.0% and the frame's border does not begin until 96.3%, while
            that inner outline sits back at about 90%. The top edge is 67.8%. So
            these insets put the badge a few pixels shy of the border and just
            inside the metallic bracket at the corner — it may cross the decorative
            outline, which is part of the panel's texture rather than its frame.

            `flex` on the wrapper is not decoration: as a block box it would put
            the badge on its baseline, four pixels below where the inset asks for
            it, which is enough to lose the corner.

            No `relative` is wanted here either — the box around this is already
            `absolute`, and an absolutely positioned element is a containing block
            for absolutely positioned children. And the badge tilts with the card
            for nothing: it sits inside the tile that `hover-3d` rotates, so unlike
            the corner controls it needs no transform of its own. */}
        <div className="absolute top-0.5 right-[5%] flex">
          <KindBadge kind={character.kind} />
        </div>
      </div>
    </HoverCard>
  );
}
