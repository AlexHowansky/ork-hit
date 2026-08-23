/** Small shared primitives, so the pages stay about behaviour rather than classes. */

import { useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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
  "group flex flex-col overflow-hidden rounded-xl border shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-lg focus-within:-translate-y-0.5 focus-within:border-amber-400 focus-within:shadow-lg dark:hover:border-amber-500/70 dark:focus-within:border-amber-500/70";

/**
 * The grid every card library sits in.
 *
 * The track is a fixed width rather than a fraction, so a card is the same size
 * in the campaign panel and the character panel even though those panels are not
 * the same width. The cost is some slack at the end of a row, which is the price
 * of the two libraries matching. Below `sm` there is only ever one column, and it
 * takes the full width rather than leaving most of a phone screen empty.
 */
export const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,11rem)]";

const VARIANTS = {
  primary:
    "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400",
  secondary:
    "bg-stone-200 text-stone-800 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
  ghost:
    "text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
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
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section
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
      <div className={`p-4 ${scroll ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>{children}</div>
    </section>
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
 * The card icons.
 *
 * Drawn inline rather than written as glyphs — the rest of the app uses text
 * symbols, but those are decorative, and a sheet, a pencil and a bin have no set
 * of characters that render alike across platforms.
 */
export function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function SheetIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

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
          className="flex h-full w-full items-center justify-center text-lg opacity-40"
          aria-hidden="true"
        >
          {kind === "pc" ? "🛡" : "🐉"}
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
}: {
  label: ReactNode;
  name: string;
  accept?: string;
  hint?: ReactNode;
  /** The file now in the field, however it arrived, for a form that wants to react. */
  onFile?: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const take = (files: FileList) => {
    const file = files.item(0);
    const input = inputRef.current;
    if (!file || !input) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    setChosen(file.name);
    onFile?.(file);
  };

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files);
        }}
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
