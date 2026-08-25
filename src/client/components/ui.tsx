/** Small shared primitives, so the pages stay about behaviour rather than classes. */

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faDragon,
  faFileLines,
  faPenToSquare,
  faShieldHalved,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type {
  ButtonHTMLAttributes,
  DragEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
} from "react";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The shape and behaviour shared by every card in the library.
 *
 * The picture is the square, not the card: the image well is a full-width square
 * and the caption sits under it at whatever height its name and buttons need. Since
 * every caption is built the same way, a row of cards still lines up whatever the
 * names are. `focus-within` repeats the hover lift for anyone arriving by keyboard,
 * since a card is a box of buttons and hover alone would leave them out.
 *
 * Callers supply the border and background colours, which vary with selection.
 */
export const CARD_BASE =
  "group flex flex-col overflow-hidden rounded-xl border-[length:var(--card-border)] shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg focus-within:-translate-y-0.5 focus-within:border-amber-400 focus-within:shadow-lg dark:hover:border-amber-500/70 dark:focus-within:border-amber-500/70";

/**
 * The strip under a card's picture, carrying its name.
 *
 * It takes the *page's* background rather than the card's, so the caption reads
 * as the ground the picture is sitting on rather than as part of the picture's
 * own tile. Kept here beside `CARD_BASE` because three libraries draw this strip
 * — campaigns, characters, and the player's pick-a-character grid — and a card
 * that matched in every respect but this one would be the odd one out.
 *
 * The value is the same pair `body` carries in `styles.css`; the two are meant to
 * be the same colour and should move together.
 */
export const CARD_CAPTION = "shrink-0 bg-stone-100 p-3 dark:bg-stone-950";

/**
 * The grid every card library sits in.
 *
 * The track is a fixed width rather than a fraction, so a card is the same size
 * in the campaign panel and the character panel even though those panels are not
 * the same width. The cost is some slack at the end of a row, which is the price
 * of the two libraries matching — on the campaign panel `useCardFit` takes that
 * slack back by trimming the panel to whole columns. Below `sm` there is only ever
 * one column, and it takes the full width rather than leaving most of a phone
 * screen empty.
 *
 * The width itself is `--card-image-size`, which the deployment sets (see
 * `server/routes/appearance.ts`) — and it names the picture rather than the card
 * because that is what it measures: the image well is the full width of the
 * track, and the border and the name below it make the card taller.
 */
export const CARD_GRID =
  "grid grid-cols-1 gap-4 " +
  "sm:grid-cols-[repeat(auto-fill,calc(var(--card-image-size)+2*var(--card-border)))]";

const VARIANTS = {
  primary:
    "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400",
  secondary:
    "bg-stone-200 text-stone-800 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
  ghost:
    "text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
  // Destructive, but quiet enough to sit in a list without shouting — one filled
  // red button per row would drown the row it belongs to. A variant rather than
  // `ghost` plus a red `className`: both set `color`, so which one wins is down
  // to the order Tailwind happens to emit them in rather than to the caller.
  dangerGhost:
    "text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950",
} as const;

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return <button {...props} className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} />;
}

/**
 * A labelled text input. `className` extends the input, as it does on `Button` —
 * not the wrapping label, or it would restyle the label and hint along with it.
 */
export function Field({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </span>
      <input
        {...props}
        className={`w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-600 ${className}`}
      />
      {hint ? (
        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * The page frame every route sits in.
 *
 * On a tall screen this is the centred column the app has always been: the page
 * grows downwards and the window scrolls. On a wide screen it becomes a fixed
 * frame exactly one viewport high that never scrolls itself — the panels inside
 * are laid out side by side and each scrolls its own list, so the controls at the
 * top of the page stay put while a list moves underneath them.
 *
 * `max` is the cap for the tall layout only; the wide layout uses the full width.
 */
export function AppPage({
  max = "max-w-6xl",
  children,
  className = "",
}: {
  max?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto ${max} space-y-5 p-4 sm:p-6 wide:flex wide:h-dvh wide:max-w-none wide:flex-col wide:gap-5 wide:space-y-0 wide:overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * `scroll` keeps a panel inside the height its parent gives it and moves its
 * body's overflow into the panel instead, leaving the heading pinned. It only
 * means anything where the parent has a height to give — inside `AppPage`'s wide
 * layout — which is why the default is off.
 */
export function Panel({
  title,
  actions,
  children,
  className = "",
  scroll = false,
  ref,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section
      {...rest}
      ref={ref}
      className={`rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 ${
        scroll ? "flex min-h-0 flex-col" : ""
      } ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {title}
        </h2>
        {actions}
      </header>
      <div
        className={`p-4 ${scroll ? "min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]" : ""}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A panel opened over the page, with a title bar and a close control.
 *
 * The counterpart to `SheetOverlay`: that one is deliberately chrome-free because
 * a character sheet is a whole page of someone else's design, whereas everything
 * here — a form, a question — is ours and wants a heading to say what it is.
 *
 * Escape closes it. A click on the dimmed backdrop deliberately does not: these
 * hold forms people are part way through typing into, and losing that to a stray
 * click is worse than the extra press it costs to leave on purpose.
 *
 * `z-40` puts it under the toasts at `z-50`, so a message about what just
 * happened is still readable over an open dialog.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-stone-900 ${
          wide ? "max-w-5xl wide:max-w-7xl" : "max-w-lg"
        }`}
      >
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <Icon icon={faXmark} />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}


/**
 * The edit and delete controls for a card, laid over the bottom right of its
 * picture.
 *
 * They sit on the image rather than in a row beneath the name so the card stays
 * mostly picture. Position it inside the card's image well, which must be
 * `relative`.
 */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className="absolute right-1 bottom-1 z-10 flex gap-1">{children}</div>;
}

/**
 * A square button carrying an icon instead of a word.
 *
 * The label is required and never drawn: an icon on its own says nothing to a
 * screen reader, and it doubles as the tooltip. The dark translucent pill is what
 * keeps the icon readable over a picture we know nothing about, in either theme.
 */
export function IconButton({
  label,
  icon,
  danger = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md bg-stone-900/60 text-white shadow-sm backdrop-blur-sm transition-colors ${
        danger ? "hover:bg-red-600" : "hover:bg-stone-900/90"
      } ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

/**
 * An icon.
 *
 * Every picture in this app comes from one set — FontAwesome's free solid icons,
 * imported one at a time and drawn as inline SVG, so there is no font to fetch
 * and nothing crosses the network. This wrapper exists so a call site names an
 * icon and a size and nothing else, and so the sizing stays Tailwind's rather
 * than the library's: the buttons here were measured against `h-4 w-4`.
 *
 * Always decorative. Every icon in the app sits either in a button that carries
 * its own `aria-label` and `title`, or inside a wrapper already marked
 * `aria-hidden` — a picture is never the only thing saying what a control does.
 */
export function Icon({
  icon,
  className = "h-4 w-4",
}: {
  icon: IconDefinition;
  className?: string;
}) {
  return <FontAwesomeIcon icon={icon} className={className} aria-hidden="true" />;
}

/**
 * The card controls' icons, named once here rather than at each card: three
 * libraries draw the same three buttons, and they must not drift apart.
 */
export const EditIcon = () => <Icon icon={faPenToSquare} />;
export const SheetIcon = () => <Icon icon={faFileLines} />;
export const DeleteIcon = () => <Icon icon={faTrash} />;

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">{children}</p>
  );
}

/** Distinguishes a PC from an NPC in lists where both appear. */
export function KindBadge({ kind }: { kind: "pc" | "npc" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
        kind === "pc"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
      }`}
    >
      {kind === "pc" ? "PC" : "NPC"}
    </span>
  );
}

/**
 * A character's picture at list size, for the session screens.
 *
 * Decorative: every list that uses one puts the character's name right beside it,
 * so the image carries no alt text and the placeholder is hidden outright.
 */
export function CharacterThumb({
  kind,
  backgroundUrl,
}: {
  kind: "pc" | "npc";
  backgroundUrl: string | null;
}) {
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
      {backgroundUrl ? (
        <img src={backgroundUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center opacity-40"
          aria-hidden="true"
        >
          <Icon icon={kind === "pc" ? faShieldHalved : faDragon} className="h-5 w-5" />
        </span>
      )}
    </div>
  );
}

/** Copies text and confirms it, for the session code and invite link. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      onClick={async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(value);
          const original = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = original;
          }, 1500);
        } catch {
          // Clipboard access can be refused; select the text so it can be copied
          // by hand rather than failing silently.
          window.prompt("Copy this:", value);
        }
      }}
    >
      {label}
    </Button>
  );
}

/**
 * The `dataTransfer` type a dragged character card carries.
 *
 * A type of its own rather than `text/plain`, so a character cannot be dropped
 * into a text field somewhere — and because during `dragover` the payload itself
 * is unreadable, so the type list is all a target has to go on.
 */
export const CHARACTER_DRAG = "application/x-ttrpg-character";

/**
 * Makes any element something can be dragged onto.
 *
 * The handlers are the whole of it — a drop target is three event listeners and
 * a flag saying whether something is hovering over it — but the file field below,
 * the character panel in the library and the campaign cards all need exactly
 * those, and a drop target that forgets to `preventDefault` on `dragover`
 * silently never fires.
 *
 * A target names the payload it takes: `"Files"` for a file, `CHARACTER_DRAG` for
 * a character card. A drag carrying anything else is left entirely alone —
 * unclaimed, so it passes through to whatever is behind, and the browser shows a
 * no-drop cursor rather than an invitation this element cannot honour. That is
 * what keeps a character dragged across the character panel from being read as
 * another sheet to upload.
 *
 * `over` is for the caller to draw with; nothing here is styled.
 */
export function useDropTarget(type: string, onDrop: (transfer: DataTransfer) => void) {
  const [over, setOver] = useState(false);

  const dropProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      setOver(true);
    },
    // Moving onto a child counts as leaving the element it bubbles from, which
    // would make the highlight flicker across a panel full of cards. A leave that
    // lands somewhere still inside is not a leave.
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      const to = event.relatedTarget;
      if (to instanceof Node && event.currentTarget.contains(to)) return;
      setOver(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      setOver(false);
      onDrop(event.dataTransfer);
    },
  };

  return { over, dropProps };
}

/** A drop target for files, which is what most of them are. */
export function useFileDropTarget(onFiles: (files: FileList) => void) {
  return useDropTarget("Files", (transfer) => onFiles(transfer.files));
}

/**
 * A file field you can also drop a file onto.
 *
 * The native input stays — visible, clickable, and still the thing the form
 * reads — because a drop zone built out of a div is invisible to a keyboard and
 * to `FormData`. A drop copies the file into that input through a `DataTransfer`,
 * so submitting works exactly as it did before there was a drop zone, and the
 * form has nothing to know about this.
 *
 * Only the first file is taken: every field here holds one. The type is not
 * checked on the way in — `accept` filters the picker, and the server checks
 * content rather than names — so a wrong file is reported by the same error the
 * picker would have produced.
 */
export function FileDrop({
  label,
  name,
  accept,
  hint,
  onFile,
  initialFile = null,
}: {
  label: ReactNode;
  name: string;
  accept?: string;
  hint?: ReactNode;
  /** The file now in the field, however it arrived, for a form that wants to react. */
  onFile?: (file: File) => void;
  /** A file the field starts out holding, for a form opened by a drop elsewhere. */
  initialFile?: File | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const take = (file: File | null) => {
    const input = inputRef.current;
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    setChosen(file.name);
    onFile?.(file);
  };

  const { over, dropProps } = useFileDropTarget((files) => take(files.item(0)));

  // A file the form was opened with is put through the same path a dropped one
  // takes, so the field, the input the form reads, and anything listening on
  // `onFile` all see it arrive the usual way.
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    if (initialFile) takeRef.current(initialFile);
  }, [initialFile]);

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </span>
      <div
        {...dropProps}
        className={`rounded-lg border border-dashed p-3 transition-colors ${
          over
            ? "border-amber-500 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30"
            : "border-stone-300 dark:border-stone-700"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.item(0) ?? null;
            setChosen(file?.name ?? null);
            if (file) onFile?.(file);
          }}
          className="w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-200 file:px-3 file:py-1.5 file:text-sm dark:text-stone-400 dark:file:bg-stone-800 dark:file:text-stone-200"
        />
        <span className="mt-2 block text-xs text-stone-500 dark:text-stone-400">
          {chosen ? `Ready to upload: ${chosen}` : "…or drop a file here."}
        </span>
      </div>
      {hint ? (
        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{hint}</span>
      ) : null}
    </label>
  );
}
