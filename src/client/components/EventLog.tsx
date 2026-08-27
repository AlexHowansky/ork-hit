/**
 * The log: what has happened at this table, and the drawer it lives in.
 *
 * A drawer rather than a panel in a column because the log is reference material
 * a table consults — "wait, when did she go down?" — and not something anybody
 * reads continuously. A column of its own would cost the console a third of its
 * width all night for a question asked twice.
 *
 * It pushes the page aside rather than covering it. Every other overlay in the
 * app — the sheet, the modals — is something you deal with and dismiss, so
 * hiding the page behind it is right. This one you may want open *while* the
 * fight runs, so nothing of the fight may go behind it, and it is deliberately
 * not modal: no backdrop, no focus trap, and the console beside it stays live.
 *
 * The events themselves come down on the session snapshot rather than as
 * notices, which is what makes the log survive a reload and lets a player who
 * joined ten minutes in read the ten minutes. See `session-state.ts`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { faRectangleList, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Button, EmptyState, Icon, Panel, TEXT_BODY, TEXT_MUTED } from "./ui.tsx";
import type { SessionEvent } from "../types.ts";

/* -------------------------------------------------------------------- state */

function storageKey(sessionId: string): string {
  return `log-drawer:${sessionId}`;
}

function read(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey(sessionId)) === "open";
  } catch {
    return false;
  }
}

/**
 * Whether the log drawer is open, and a way to change it.
 *
 * Closed by default: the console is what the page is for, and a drawer that
 * opened itself would take a slice of it from everyone who never asked.
 *
 * Remembered per session in `sessionStorage`, exactly as the segment filter is
 * and for the same reasons — it should survive a reload mid-fight, it should not
 * still be set months later at a different table, it is nobody's business but
 * this reader's, and a browser told to block site data throws on the property
 * itself rather than returning nothing.
 */
export function useLogDrawer(sessionId: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => read(sessionId));

  const toggle = useCallback(() => {
    setOpen((was) => {
      const now = !was;
      try {
        window.sessionStorage.setItem(storageKey(sessionId), now ? "open" : "closed");
      } catch {
        // A remembered preference is a convenience; the drawer still opens
        // without it, for this visit at least.
      }
      return now;
    });
  }, [sessionId]);

  return [open, toggle];
}

/* ------------------------------------------------------------------ control */

/**
 * The control that opens and closes the drawer, for the left of a page header.
 *
 * `aria-expanded` is the whole of the state readout — the label stays `Log`
 * either way, because it names the thing rather than the action, and the drawer
 * sliding out beside it is not something anybody needs told twice.
 */
export function LogToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? "Hide the log" : "Show what has happened this session"}
    >
      <Icon icon={faRectangleList} /> Log
    </Button>
  );
}

/* ------------------------------------------------------------------- drawer */

/** How near the bottom counts as "still following along". */
const PINNED_SLACK_PX = 24;

function timeOf(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LogDrawer({
  events,
  open,
  onClose,
}: {
  events: SessionEvent[];
  open: boolean;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Escape closes it, as it does every other layer in the app. Bound only while
  // it is open, so a stray Escape over the console is nobody's business.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /*
   * New events arrive at the bottom, so the bottom is where the drawer should be
   * — but only for somebody who was already there. Scrolled back to read what
   * happened two segments ago, being yanked forward by an unrelated event is
   * losing your place in a document, which is worse than having to scroll down.
   *
   * It runs on `open` as well as on the count because a closed drawer has no
   * scroll height to set: whatever arrived while it was shut has to be caught up
   * on the way out.
   */
  useEffect(() => {
    // `scroll` puts the overflow on the panel's own body, so that — the list's
    // parent — is what actually scrolls, not the list.
    const scroller = listRef.current?.parentElement;
    if (!scroller || !open) return;

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    // `scrollTop` is 0 on a list that has never been shown, which reads as
    // scrolled to the top rather than as following along — so an opening drawer
    // always pins, and only a list somebody has scrolled by hand gets a say.
    if (distanceFromBottom > PINNED_SLACK_PX && scroller.scrollTop > 0) return;

    scroller.scrollTop = scroller.scrollHeight;
  }, [open, events.length]);

  /*
   * The slide is the collapse of this wrapper, and which way it collapses
   * depends on whether there is a sideways to give.
   *
   * Below `lg:` the page has no width to spare — the console is already down to
   * two narrow halves, and taking a fixed slice off them clips buttons and folds
   * names in two. So there the drawer is a block above the console and collapses
   * by height. From `lg:` up it is a column of its own and collapses by width,
   * which is what "pushes the console aside" means.
   *
   * The gap between the drawer and the console is the drawer's own margin rather
   * than the row's `gap`, because a gap is drawn between two children whether or
   * not one of them has any width — and a closed drawer would then hold the
   * console a whole gap off the edge of the page for no reason anybody could
   * see. As a margin it collapses along with the rest of the drawer, so shut, the
   * drawer costs the page exactly nothing.
   */
  return (
    <aside
      // Hidden from everything, not merely from the eye: a collapsed drawer is
      // still in the document, and a list nobody can see is not one a screen
      // reader should be reading out or a Tab should be landing in.
      aria-hidden={!open}
      inert={!open}
      className={`flex flex-col overflow-hidden transition-[max-height,width,margin] duration-200 ease-out motion-reduce:transition-none lg:max-h-none wide:min-h-0 ${
        open
          ? "mb-2.5 max-h-[60vh] w-full lg:mr-2.5 lg:mb-0 lg:w-72 wide:w-80"
          : "mb-0 max-h-0 w-full lg:mr-0 lg:w-0"
      }`}
    >
      {/* The open width, fixed, so the text inside does not reflow line by line
          while the wrapper animates around it. `flex-1 min-h-0` is what gives
          the panel a bounded height to scroll inside, in both the phone's
          `max-h` and the wide frame's stretched column.

          Wider on a dashboard than on a laptop, because there it is taking the
          room from a third column rather than from two: a log wide enough not to
          fold its lines is worth more than the inch it costs a panel of names. */}
      <div className="flex min-h-0 w-full flex-1 flex-col lg:w-72 wide:w-80">
        <Panel
          title="Log"
          scroll
          className="min-h-0 flex-1"
          actions={
            <Button
              variant="ghost"
              onClick={onClose}
              aria-label="Close the log"
              title="Close the log"
            >
              <Icon icon={faXmark} />
            </Button>
          }
        >
          {events.length === 0 ? (
            <EmptyState>Nothing has happened yet.</EmptyState>
          ) : (
            // Oldest at the top, newest at the bottom, the way a transcript
            // reads. The times are tabular so the messages line up as a column
            // rather than stepping in and out by a digit's width, and a message
            // too long for the drawer wraps under itself rather than back under
            // the clock — a folded line should read as one event continuing, not
            // as a second one that forgot to say when.
            <ol className="space-y-1 text-sm" ref={listRef}>
              {events.map((event) => (
                <li key={event.id} className="flex gap-2">
                  <time dateTime={event.at} className={`shrink-0 tabular-nums ${TEXT_MUTED}`}>
                    {timeOf(event.at)}
                  </time>
                  <span className={`min-w-0 flex-1 ${TEXT_BODY}`}>{event.message}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </aside>
  );
}
