/**
 * What condition a character on the stage is in.
 *
 * Two pieces that belong together: the pills that read a character's conditions
 * off a row, and the dialog that sets them.
 *
 * Every one of them is its word, named or typed alike. The eight the app knows
 * each had a picture once, and it earned nothing: a glyph for "Suppressed" is a
 * puzzle where the word is not, a typed tag never had one that meant anything,
 * and a pill carrying both spent width saying one thing twice.
 *
 * The names themselves are in `src/lib/hero.ts`, which the server shares, so a
 * log line and a pill call a condition the same thing.
 */

import { useState, type FormEvent } from "react";
import { faTag } from "@fortawesome/free-solid-svg-icons";
import {
  isKnownTag,
  normalizeTag,
  STATUS_TAG_HINTS,
  STATUS_TAG_MAX_LENGTH,
  STATUS_TAGS,
  tagLabel,
} from "../../lib/hero.ts";
import {
  bareIcon,
  Button,
  Field,
  HAIRLINE,
  Icon,
  Modal,
  PANEL_CAPTION,
  TEXT_MUTED,
} from "./ui.tsx";
import type { SessionCharacter } from "../types.ts";

/** What to call a condition, and what to add under the pointer. */
function present(tag: string): { label: string; hint?: string } {
  return isKnownTag(tag)
    ? { label: tagLabel(tag), hint: STATUS_TAG_HINTS[tag] }
    : { label: tagLabel(tag) };
}

/**
 * The conditions a character is in, as pills beside their name.
 *
 * The word, and nothing else. A named tag used to be a picture alone, on the
 * grounds that a row is already crowded — but a condition nobody can read
 * without hovering is one that gets missed in a fight. The pills truncate rather
 * than push the row about, and each carries the same word the picker's button
 * does, so the two never disagree about what a condition is called.
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
        const { label, hint } = present(tag);
        return (
          <span
            key={tag}
            title={hint ? `${label} — ${hint}` : label}
            className="badge badge-xs badge-primary badge-soft max-w-32 truncate font-semibold"
          >
            {label}
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
  const { label, hint } = present(tag);
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint ?? label}
      onClick={() => onToggle(!on)}
      // Pressed is a filled background as well as a colour, so the state is not
      // carried by hue alone.
      // Centred, which is `btn`'s own default: the glyph these used to lead with
      // is what wanted them left-aligned, so that a column of buttons lined its
      // pictures up. A column of words reads better down the middle.
      className={`btn ${on ? "btn-primary" : ""}`}
    >
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
          <p className={`mt-5 mb-1 text-xs ${PANEL_CAPTION}`}>Custom</p>
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
        {/*
          Full size, so the button is exactly as tall as the field it submits:
          daisyUI sizes both off `--size-field`, and `sm` against a field was 8
          of it against 10. It also matches the condition buttons above, which is
          the same press. Nothing to nudge with once the heights agree — the
          form's `items-end` lands the two on one line by itself.
        */}
        <Button type="submit" size="md">
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
export function StatusTagButton({ character, onOpen, bare = false }: {
  character: SessionCharacter;
  onOpen: () => void;
  /** Just the glyph, for the segment row's cluster. See `bareIcon`. */
  bare?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
      title={`Set ${character.name}'s status`}
      aria-label={`Set ${character.name}'s status`}
      className={bare ? bareIcon() : `btn btn-ghost btn-square btn-xs ${TEXT_MUTED}`}
    >
      <Icon icon={faTag} />
    </button>
  );
}
