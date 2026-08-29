/**
 * Displays an uploaded character sheet.
 *
 * The sheet is the game master's own HTML and keeps its JavaScript, so it is
 * loaded in an iframe with `sandbox` and deliberately *without*
 * `allow-same-origin`. That puts it in an opaque origin: its scripts still run,
 * but it cannot read this page's cookies or storage, reach into the DOM around
 * it, or call the API as the signed-in user. The response carries the same
 * sandbox as a header, so the restriction does not depend on this attribute
 * alone.
 */

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useEffect } from "react";
import { Icon, IconButton } from "./ui.tsx";

export function SheetFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={`${title} — character sheet`}
      // allow-scripts without allow-same-origin is the isolation boundary.
      // allow-forms and allow-popups let an interactive sheet behave normally.
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
      loading="lazy"
      // Nothing of ours around it: no border, no rounding, no padding. A sheet is
      // a whole page of someone else's design and is shown as it was written.
      className="h-full w-full border-0 bg-white"
    />
  );
}

/**
 * A sheet opened over the page, wherever it was opened from.
 *
 * It carries the window's own aspect ratio: `--sheet-size` is one percentage and
 * it sets both dimensions, so at the default of 90 the sheet is nine tenths of the
 * window each way — the same shape, smaller, with the dimmed page still showing
 * around it — and at 100 it fills the viewport outright. The deployment chooses
 * the number (`SHEET_WIDTH_PCT`; see `server/routes/appearance.ts`).
 *
 * There is no title bar, because a sheet already says whose it is and a strip of
 * our own would take the room and change the shape. The one thing over it is the
 * close control, in the window's own top right rather than the sheet's, so it is
 * in the same place whatever size the sheet is drawn at. It is an `IconButton`
 * because that is already built to stay readable over something it knows nothing
 * about, which here is either the dimmed page or the sheet itself.
 *
 * Escape closes it, and so does a click on the dimmed page around it — that is
 * `event.target === event.currentTarget`, so only the backdrop itself counts and
 * a click that started on the sheet or the button does not.
 */
export function SheetOverlay({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal modal-open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} character sheet`}
        className="h-[calc(var(--sheet-size)*1dvh)] w-[calc(var(--sheet-size)*1dvw)] overflow-hidden bg-base-100"
      >
        <SheetFrame src={src} title={title} />
      </div>
      <IconButton
        label="Close"
        icon={<Icon icon={faXmark} />}
        onClick={onClose}
        className="absolute top-2 right-2 z-10"
      />
    </div>
  );
}
