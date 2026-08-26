/** Small shared primitives, so the pages stay about behaviour rather than classes. */

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCheck,
  faDragon,
  faEye,
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

/*
  The colours and shapes the screens repeat, named once.

  These are interpolated into `className` strings rather than written as CSS
  classes with `@apply`, which is what Tailwind itself recommends for a React
  codebase and what keeps every class in this app inside one mental model: when
  two of them set the same property, which wins is decided by the order Tailwind
  emits them in, and that rule holds for a constant exactly as it does for a
  literal. It is also why each of these deliberately leaves out any property its
  callers disagree about — see the notes on the ones that do.
*/

/** Secondary text: a caption, a hint, a count, anything read after the thing itself. */
export const TEXT_MUTED = "text-stone-500 dark:text-stone-400";

/** A heading, or a name — the thing on the screen with the most to say. */
export const TEXT_STRONG = "text-stone-900 dark:text-stone-100";

/** Ordinary running text, a step quieter than a heading and louder than a hint. */
export const TEXT_BODY = "text-stone-800 dark:text-stone-200";

/**
 * The colour of a rule between two parts of a panel — and only the colour: which
 * edge it is drawn on is the caller's, since the four that use it disagree
 * (`border-b` under a panel heading, `border-t` above the Vitals actions).
 */
export const HAIRLINE = "border-stone-200 dark:border-stone-800";

/**
 * A raised box on the page's ground: panels, dialogs, the sign-in card.
 *
 * No shadow and no padding. Most of these want `shadow-sm` and one — the turn
 * bar — deliberately does not, so it is added at the call site rather than
 * fought with here.
 */
export const SURFACE =
  "rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900";

/**
 * The caption above a form field. Every field in the app is a `<label>` whose
 * first child is this, which is the shape `tests/e2e.test.ts` reads a form by.
 */
export const FIELD_CAPTION = "mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300";

/**
 * The small upright heading over a panel or a group of numbers. Carries no font
 * size: these run from `text-[10px]` over a Vitals box to `text-sm` over a
 * panel, and the size is the part each caller chooses.
 */
export const PANEL_CAPTION =
  "font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400";

/** A box someone types or chooses in: text inputs and selects alike. */
export const FORM_CONTROL =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm " +
  "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

/**
 * A file input, whose button is styled through `file:` rather than by hiding the
 * control and drawing our own — the native one already opens the right picker
 * and says the right thing to a screen reader.
 */
export const FILE_INPUT =
  "w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 " +
  "file:bg-stone-200 file:px-3 file:py-1.5 file:text-sm dark:text-stone-400 " +
  "dark:file:bg-stone-800 dark:file:text-stone-200";

/** A card's name, in the strip under its picture. Truncates rather than wraps. */
export const CARD_NAME = "truncate font-medium text-stone-900 dark:text-stone-100";

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
 *
 * The caption and the hint are nodes rather than strings, so a caller can put a
 * word in italics or a piece of code in a `<code>` without the component
 * learning about either. Markup goes in as JSX, never as a string of HTML:
 * `hint={<>This is <em>your</em> name.</>}`.
 */
export function Field({
  label,
  hint,
  title,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    // `title` is lifted off the input and onto the whole label, so the caption
    // explains itself on hover too: a one-word caption over a number box is
    // exactly the part a reader points at when they don't know what it means.
    <label className="block" title={title}>
      <span className={FIELD_CAPTION}>{label}</span>
      <input
        {...props}
        className={`${FORM_CONTROL} text-stone-900 placeholder:text-stone-400 focus:border-amber-500 dark:placeholder:text-stone-600 ${className}`}
      />
      {hint ? <span className={`mt-1 block text-xs ${TEXT_MUTED}`}>{hint}</span> : null}
    </label>
  );
}

/**
 * The page frame every route sits in.
 *
 * It takes the whole window, whatever the window is. There used to be a centred
 * column with a maximum width, which is right for a page of prose and wrong for
 * this: every screen here is panels of lists and cards, and a tall monitor —
 * wide enough for two columns but not wide *enough* to count as a dashboard —
 * left two thirds of the glass empty while a panel inside it needed a scrollbar.
 *
 * On a tall screen the page grows downwards and the window scrolls. On a wide
 * one it becomes a fixed frame exactly one viewport high that never scrolls
 * itself — the panels are laid out side by side and each scrolls its own list,
 * so the controls at the top stay put while a list moves underneath them.
 */
export function AppPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full space-y-2.5 p-2 sm:p-3 wide:flex wide:h-dvh wide:flex-col wide:gap-2.5 wide:space-y-0 wide:overflow-hidden ${className}`}
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
 *
 * A panel with no `title` and no `actions` has no heading strip at all: a row of
 * controls that says plainly what it is does not need a word above it repeating
 * the point.
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
  title?: ReactNode;
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
      className={`${SURFACE} shadow-sm ${scroll ? "flex min-h-0 flex-col" : ""} ${className}`}
    >
      {title || actions ? (
        <header
          className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 ${HAIRLINE}`}
        >
          <h2 className={`${PANEL_CAPTION} text-sm`}>{title}</h2>
          {actions}
        </header>
      ) : null}
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
        <header className={`flex items-center justify-between border-b px-5 py-3 ${HAIRLINE}`}>
          <h2 className={`font-semibold ${TEXT_STRONG}`}>{title}</h2>
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
export const SheetIcon = () => <Icon icon={faEye} />;
export const DeleteIcon = () => <Icon icon={faTrash} />;

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={`py-8 text-center text-sm ${TEXT_MUTED}`}>{children}</p>;
}

/**
 * A whole screen that has nothing to show yet, as against `EmptyState`, which is
 * a panel that has nothing in it. Roomier and at full size, because this is the
 * only thing on the page rather than one empty box among several.
 */
export function LoadingNote({ children }: { children: ReactNode }) {
  return <p className={`p-8 text-center ${TEXT_MUTED}`}>{children}</p>;
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
 * How many of this thing there are: a second goblin, or three of them waiting in
 * the library.
 *
 * Beside `KindBadge` because it is the same badge in a quieter colour, and the
 * two are drawn side by side in both lists that use them. `tabular-nums` so a
 * count changing from 9 to 10 does not shift the row.
 */
export function CountBadge({
  children,
  title,
  hidden = false,
}: {
  children: ReactNode;
  title?: string;
  /** For a count that reads as part of the name beside it rather than as a badge. */
  hidden?: boolean;
}) {
  return (
    <span
      title={title}
      aria-hidden={hidden ? "true" : undefined}
      className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-stone-700 dark:bg-stone-700 dark:text-stone-200"
    >
      {children}
    </span>
  );
}

/**
 * The square picture well at the top of a card.
 *
 * `relative` because the things that sit over a picture — the kind badge, the
 * card's edit and delete controls, a full-bleed select button — are positioned
 * against it. It takes children rather than a prop for each, since the three
 * card libraries overlay different things.
 */
export function CardWell({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-stone-200 dark:bg-stone-800">
      {children}
    </div>
  );
}

/**
 * What is actually in a card's well: the picture, or a stand-in icon when there
 * is none.
 *
 * Always decorative — every card puts the name in the strip underneath — so the
 * image carries no alt text and the placeholder is hidden outright. The gentle
 * zoom is keyed on the card's `group`, which `CARD_BASE` establishes, so hovering
 * anywhere on the card moves the picture.
 */
export function CardPicture({
  src,
  icon,
  draggable,
}: {
  src: string | null;
  /** Drawn in the picture's place when there is none: a shield, a dragon, a scroll. */
  icon: IconDefinition;
  /**
   * Pass `false` on a card that can itself be picked up. An image is draggable in
   * its own right and would otherwise start a drag carrying the picture's URL
   * instead of the card's own.
   */
  draggable?: boolean;
}) {
  if (!src) {
    return (
      <div className="flex h-full items-center justify-center opacity-30" aria-hidden>
        <Icon icon={icon} className="h-12 w-12" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={draggable}
      loading="lazy"
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 group-focus-within:scale-105"
    />
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

/**
 * Copies text and confirms it, for the session code and invite link.
 *
 * The confirmation is React's own state rather than a write to `textContent`,
 * which is what it used to be: the button carries an icon now, and rewriting the
 * text content of the button would take the icon out with the word.
 */
export function CopyButton({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: IconDefinition;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A button unmounted while the message is still up — the panel it sits in is
  // redrawn on every snapshot — must not be woken later to set state.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be refused; offer the text so it can be copied
          // by hand rather than failing silently.
          window.prompt("Copy this:", value);
        }
      }}
    >
      <Icon icon={copied ? faCheck : icon} />
      {copied ? "Copied" : label}
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
      <span className={FIELD_CAPTION}>{label}</span>
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
          className={FILE_INPUT}
        />
        <span className={`mt-2 block text-xs ${TEXT_MUTED}`}>
          {chosen ? `Ready to upload: ${chosen}` : "…or drop a file here."}
        </span>
      </div>
      {hint ? <span className={`mt-1 block text-xs ${TEXT_MUTED}`}>{hint}</span> : null}
    </label>
  );
}
