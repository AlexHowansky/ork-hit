/**
 * Per-reader settings, and the drawer they live in.
 *
 * The log's drawer, mirrored: it pushes the page aside rather than covering it,
 * it is not modal — no backdrop, no focus trap, and the console beside it stays
 * live — and Escape closes it. What differs is the side. The log comes out of
 * the top left because its control is in that corner; these come out of the top
 * right because theirs is, and a reader who has just pressed the gear should
 * find the panel under their finger rather than across the page.
 *
 * What is in it belongs to the game master rather than to the table, and is kept
 * on their row in the database so that it follows them to whichever machine they
 * sign in on. The drawer is on the game master's screens only for that reason: a
 * player has no account to keep a setting against.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { faGear, faXmark } from "@fortawesome/free-solid-svg-icons";
import { CARD_IMAGE_PX } from "../../lib/cards.ts";
import { api } from "../api.ts";
import { useCardSize } from "../cardSize.ts";
import { Button, Icon, Panel, PANEL_CAPTION, TEXT_MUTED } from "./ui.tsx";
import { useToast } from "./Toast.tsx";

/* -------------------------------------------------------------------- state */

/**
 * Whether the settings drawer is open, and a way to change it.
 *
 * Not remembered, which is where this parts company with `useLogDrawer`. The log
 * is open *while* a fight runs and should survive a reload mid-turn; settings are
 * something a reader opens, changes and shuts. A drawer that reopened itself on
 * every load would be taking a slice of the console for a visit nobody asked to
 * repeat.
 */
export function useSettingsDrawer(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return [open, toggle];
}

/* ------------------------------------------------------------------ control */

/**
 * The control that opens and closes the drawer, for the right of a page header.
 *
 * The gear alone, where the log's control carries its word: this one sits in a
 * run of icon buttons — the theme's three, and the sign-out beside it — and a
 * labelled button in the middle of them would read as the odd one out. The name
 * is in the tooltip and in `sr-only` text, so it is a labelled button to
 * everything that is not the eye.
 */
export function SettingsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? "Hide settings" : "Settings"}
    >
      <Icon icon={faGear} />
      <span className="sr-only">Settings</span>
    </Button>
  );
}

/* ----------------------------------------------------------------- settings */

/** How long a drag has to settle before it is worth a request. */
const SAVE_DELAY_MS = 400;

/** Ties the slider to its label. One drawer to a page, so one id will do. */
const CARD_SIZE_ID = "setting-card-size";

/**
 * How big this game master wants cards drawn.
 *
 * The slider moves the cards themselves as it is dragged — `applyCardSize` puts
 * the new value straight onto the page, and the library behind the drawer
 * reflows under the reader's thumb. That is the whole point of a range control
 * here rather than a number field: the answer to "how big should a card be" is
 * something you recognise when you see it, not something you can type.
 *
 * The save is held back until the drag settles, so crossing the track is one
 * request rather than forty. A failed save is said out loud, since the cards
 * would otherwise keep the size the reader chose and quietly lose it on the next
 * sign-in; what is on the page stays either way, because taking their choice
 * back off the screen would be a second surprise on top of the first.
 */
function CardSize() {
  const [size, setSize] = useCardSize();
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A drag left in flight when the drawer closes — or when the page navigates —
  // should not fire afterwards.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const choose = (px: number) => {
    setSize(px);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api.patchJson("/api/settings", { cardImagePx: px }).catch((error) => {
        toast.showError(error);
      });
    }, SAVE_DELAY_MS);
  };

  return (
    // A `label for` rather than a label wrapped around the lot. Wrapping would
    // hand the slider every word inside it as its accessible name — the reading,
    // the units and the sentence underneath — which is a mouthful to hear read
    // out and matches half the other controls in the app when a test or a screen
    // reader goes looking for one by name. `for` names it "Card size", which is
    // what it is called.
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={CARD_SIZE_ID} className={`text-sm ${PANEL_CAPTION}`}>
          Card size
        </label>
        {/* The number the slider is on, in the unit the setting is measured in.
            Tabular, so the reading does not jitter sideways as the digits change
            under a drag. */}
        <span className={`text-xs tabular-nums ${TEXT_MUTED}`}>{size}px</span>
      </div>
      <input
        id={CARD_SIZE_ID}
        type="range"
        className="range range-sm w-full"
        min={CARD_IMAGE_PX.min}
        max={CARD_IMAGE_PX.max}
        step={CARD_IMAGE_PX.step}
        value={size}
        onChange={(event) => choose(Number(event.target.value))}
      />
      <p className={`text-xs ${TEXT_MUTED}`}>
        How large the picture on a card is drawn. The card itself comes out
        taller — its frame and the name underneath are extra.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- drawer */

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes it, as it does every other layer in the app. Bound only while
  // it is open, so a stray Escape over the page is nobody's business.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /*
   * The slide is the collapse of this wrapper, and which way it collapses
   * depends on whether there is a sideways to give — the reasoning is the log
   * drawer's, written out there. Two things are the other way round here:
   *
   * The margin is on the left (`lg:ml-2.5`), since the page is on that side, and
   * it collapses with the rest so a shut drawer costs the page nothing.
   *
   * And below `lg:` this is a block above the page rather than below it
   * (`order-first`), even though it is last in the markup so that it lands on
   * the right once there are columns. A drawer that opened below a full page of
   * panels would be a press that visibly did nothing.
   */
  return (
    <aside
      // Named, as the log's drawer is: two complementary landmarks on one page,
      // and which is which should not be a matter of reading their contents.
      aria-label="Settings"
      // Hidden from everything, not merely from the eye: a collapsed drawer is
      // still in the document, and controls nobody can see are not ones a screen
      // reader should be reading out or a Tab should be landing in.
      aria-hidden={!open}
      inert={!open}
      className={`order-first flex flex-col overflow-hidden transition-[max-height,width,margin] duration-200 ease-out motion-reduce:transition-none lg:order-none lg:max-h-none wide:min-h-0 ${
        open
          ? "mb-2.5 max-h-[60vh] w-full lg:mb-0 lg:ml-2.5 lg:w-72 wide:w-80"
          : "mb-0 max-h-0 w-full lg:ml-0 lg:w-0"
      }`}
    >
      {/* The open width, fixed, so the text inside does not reflow line by line
          while the wrapper animates around it. `flex-1 min-h-0` is what gives
          the panel a bounded height to scroll inside, in both the phone's
          `max-h` and the wide frame's stretched column. */}
      <div className="flex min-h-0 w-full flex-1 flex-col lg:w-72 wide:w-80">
        <Panel
          title="Settings"
          scroll
          className="min-h-0 flex-1"
          actions={
            <Button
              variant="ghost"
              onClick={onClose}
              aria-label="Close settings"
              title="Close settings"
            >
              <Icon icon={faXmark} />
            </Button>
          }
        >
          <div className="space-y-4">
            <CardSize />
          </div>
        </Panel>
      </div>
    </aside>
  );
}
