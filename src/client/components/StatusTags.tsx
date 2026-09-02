/**
 * What condition a character on the stage is in.
 *
 * Three pieces that belong together: the picture for each of the conditions the
 * app knows by name, the pills that read them off a row, and the dialog that
 * sets them.
 *
 * The names themselves are in `src/lib/hero.ts`, which the server shares; only
 * the pictures are here, because FontAwesome is the browser's business. A tag
 * that is not one of the named ones is one the table typed for itself, and is
 * drawn with a generic mark and its own word — there is no icon for "On fire"
 * that anybody would read as on fire.
 */

import { useState, type FormEvent } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBatteryQuarter,
  faFaceDizzy,
  faLink,
  faMoon,
  faPersonFalling,
  faSkull,
  faSun,
  faTag,
  faWeightHanging,
} from "@fortawesome/free-solid-svg-icons";
import {
  isKnownTag,
  normalizeTag,
  STATUS_TAG_HINTS,
  STATUS_TAG_MAX_LENGTH,
  STATUS_TAGS,
  type StatusTag,
  tagLabel,
} from "../../lib/hero.ts";
import { Button, Field, HAIRLINE, Icon, Modal, PANEL_CAPTION, TEXT_MUTED } from "./ui.tsx";
import type { SessionCharacter } from "../types.ts";

/**
 * The picture for each condition.
 *
 * `faBed` is deliberately not the sleeping one: `Vitals.tsx` already uses it for
 * the rest control, which sits inches away on the same row, and one picture
 * meaning two things that close together is worse than a less obvious moon.
 */
const STATUS_TAG_ICONS: Record<StatusTag, IconDefinition> = {
  dead: faSkull,
  drained: faBatteryQuarter,
  entangled: faLink,
  flashed: faSun,
  prone: faPersonFalling,
  sleeping: faMoon,
  stunned: faFaceDizzy,
  suppressed: faWeightHanging,
};

/** What to draw and what to call it, for a named condition or a typed one. */
function present(tag: string): { icon: IconDefinition; label: string; hint?: string } {
  return isKnownTag(tag)
    ? { icon: STATUS_TAG_ICONS[tag], label: tagLabel(tag), hint: STATUS_TAG_HINTS[tag] }
    : { icon: faTag, label: tagLabel(tag) };
}

/**
 * The conditions a character is in, as pills beside their name.
 *
 * A named one is its picture alone: a row already carries a name, a kind, a
 * count and four characteristics, and eight spelled-out conditions would be
 * wider than all of it. The word is in the tooltip and in a hidden span, so it
 * is there for a screen reader and for anybody who does not know the picture.
 * A typed tag keeps its word, since its picture says nothing.
 *
 * The colours are solid rather than faint on purpose: a row whose character has
 * no phase this segment is drawn at `opacity-60`, and opacity on a parent cannot
 * be undone by a child — being dead does not change your SPD, so the pill a game
 * master most wants to spot is one that spends eleven segments in twelve dimmed.
 */
export function StatusTagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => {
        const { icon, label, hint } = present(tag);
        return (
          <span
            key={tag}
            title={hint ? `${label} — ${hint}` : label}
            className="badge badge-xs badge-primary badge-soft max-w-32 gap-1 font-semibold"
          >
            <Icon icon={icon} className="h-3 w-3" />
            {isKnownTag(tag) ? <span className="sr-only">{label}</span> : (
              <span className="truncate">{label}</span>
            )}
          </span>
        );
      })}
    </>
  );
}

/** One condition in the picker: pressed when the character is in it. */
function TagToggle({
  tag,
  on,
  onToggle,
}: {
  tag: string;
  on: boolean;
  onToggle: (active: boolean) => void;
}) {
  const { icon, label, hint } = present(tag);
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint ?? label}
      onClick={() => onToggle(!on)}
      // Pressed is a filled background as well as a colour, so the state is not
      // carried by hue alone.
      className={`btn justify-start gap-2 ${on ? "btn-primary" : ""}`}
    >
      <Icon icon={icon} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The dialog that sets a character's conditions.
 *
 * It stays open as tags are pressed, unlike the picker for the numbers, which
 * closes on the one value it was opened for: one hit commonly leaves a character
 * both prone and stunned, and a dialog that shut after each would be reopened
 * straight away. Closing it is the close control.
 *
 * Each press sends the state the tag should end in rather than "flip it", which
 * is what makes a doubled tap or a retried request harmless.
 */
export function StatusTagPicker({
  character,
  onToggle,
  onClose,
}: {
  character: SessionCharacter;
  onToggle: (tag: string, active: boolean) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const current = character.statusTags;
  const custom = current.filter((tag) => !isKnownTag(tag));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const tag = normalizeTag(typed);
    if (!tag) return;
    onToggle(tag, true);
    setTyped("");
  };

  return (
    <Modal title={`Status — ${character.name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STATUS_TAGS.map((tag) => (
          <TagToggle
            key={tag}
            tag={tag}
            on={current.includes(tag)}
            onToggle={(active) => onToggle(tag, active)}
          />
        ))}
      </div>

      {custom.length > 0 ? (
        <>
          <p className={`mt-5 mb-1 text-xs ${PANEL_CAPTION}`}>This table's own</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {custom.map((tag) => (
              <TagToggle key={tag} tag={tag} on onToggle={(active) => onToggle(tag, active)} />
            ))}
          </div>
        </>
      ) : null}

      <form className={`mt-5 flex items-end gap-2 border-t pt-4 ${HAIRLINE}`} onSubmit={add}>
        {/* The label is what grows, since `Field` puts its className on the input. */}
        <div className="flex-1">
          <Field
            label="Add a tag"
            value={typed}
            maxLength={STATUS_TAG_MAX_LENGTH}
            placeholder="On fire"
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <Button type="submit" className="mb-px">
          Add
        </Button>
      </form>
    </Modal>
  );
}

/**
 * The control that opens the picker, for a reader who may write this character.
 *
 * Sized and styled like the Recovery and rest controls it sits beside, including
 * their guard against a press being taken for the start of a drag.
 */
export function StatusTagButton({ character, onOpen }: {
  character: SessionCharacter;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
      title={`Set ${character.name}'s status`}
      aria-label={`Set ${character.name}'s status`}
      className={`btn btn-ghost btn-square btn-xs ${TEXT_MUTED}`}
    >
      <Icon icon={faTag} />
    </button>
  );
}
