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

/*
  The shapes the screens repeat, named once.

  Colour is daisyUI's. Every class here is either one of its component classes
  (`btn`, `card`, `badge`, `input`) or one of its semantic tokens (`base-100`,
  `base-content`, `primary`, `error`) — nothing in this app names a colour from a
  palette, and nothing carries a `dark:` twin, because the active theme decides
  what each token resolves to. See `styles.css` for which themes those are.

  What is left here is the handful of decisions daisyUI has no opinion about: how
  a card library is laid out, how quiet a caption should be, what the strip under
  a picture sits on. These are interpolated into `className` strings rather than
  written as CSS classes with `@apply`, which is what Tailwind itself recommends
  for a React codebase: when two of them set the same property, which wins is
  decided by the order Tailwind emits them in, and that rule holds for a constant
  exactly as it does for a literal. It is also why each of these deliberately
  leaves out any property its callers disagree about — see the notes on the ones
  that do.
*/

/** Secondary text: a caption, a hint, a count, anything read after the thing itself. */
export const TEXT_MUTED = "text-base-content/60";

/**
 * The colour of a rule between two parts of a panel — and only the colour: which
 * edge it is drawn on is the caller's, since the four that use it disagree
 * (`border-b` under a panel heading, `border-t` above the Vitals actions).
 */
export const HAIRLINE = "border-base-300";

/**
 * The caption above a form field. Every field in the app is a `<label>` whose
 * first child is this, which is the shape `tests/e2e.test.ts` reads a form by —
 * which is also why these are not daisyUI's `fieldset`/`legend` form pattern.
 */
export const FIELD_CAPTION = "mb-1 block text-sm font-medium";

/**
 * The small upright heading over a panel or a group of numbers. Carries no font
 * size: these run from `text-[10px]` over a Vitals box to `text-sm` over a
 * panel, and the size is the part each caller chooses.
 */
export const PANEL_CAPTION = `font-semibold tracking-wide uppercase ${TEXT_MUTED}`;

/** A card's name, in the strip under its picture. Truncates rather than wraps. */
export const CARD_NAME = "truncate font-medium";

/**
 * The shape shared by every card in the library — the tile itself, without the
 * behaviour, which `HoverCard` around it supplies.
 *
 * daisyUI's `card` gives the rounding and the surface; the rest is this app's.
 * The picture is the square, not the card: the image well is a full-width square
 * and the caption sits under it at whatever height its name needs. Since every
 * caption is built the same way, a row of cards still lines up whatever the names
 * are.
 *
 * Deliberately carries no `transform`, no `transition` and no hover shadow.
 * `hover-3d` sets all three on this element to tilt it, and a Tailwind utility
 * for any of them would silently win — Tailwind's utilities are unlayered inside
 * `@layer utilities` while daisyUI's sit in a sublayer of it, so the utility
 * takes precedence and the tilt would simply stop. The lift these used to have is
 * what the tilt replaces.
 *
 * The hover and focus colours are `group-` variants because the pointer is never
 * actually over this element: `hover-3d`'s eight zones cover it and are its
 * siblings, not its children, so its own `:hover` never fires. The group is the
 * `hover-3d` wrapper, which the zones *are* inside.
 *
 * Callers supply the border and background colours, which vary with selection.
 */
export const CARD_BASE =
  "card flex flex-col overflow-hidden border-[length:var(--card-border)] shadow-sm group-hover:border-primary group-focus-within:border-primary";

/**
 * The strip under a card's picture, carrying its name.
 *
 * It takes the *page's* background rather than the card's, so the caption reads
 * as the ground the picture is sitting on rather than as part of the picture's
 * own tile. Kept here beside `CARD_BASE` because three libraries draw this strip
 * — campaigns, characters, and the player's pick-a-character grid — and a card
 * that matched in every respect but this one would be the odd one out.
 *
 * `base-200` is the same token `body` carries in `styles.css`; the two are meant
 * to be the same colour and should move together.
 */
export const CARD_CAPTION = "shrink-0 bg-base-200 p-3";

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

/*
  Which daisyUI colour a button takes.

  `secondary` is a plain `btn` on purpose: unqualified, daisyUI draws the quiet
  neutral button this app wants for its non-primary actions, whereas
  `btn-secondary` is a second loud colour. `dangerGhost` is destructive but quiet
  enough to sit in a list without shouting — one filled red button per row would
  drown the row it belongs to.
*/
const VARIANTS = {
  primary: "btn-primary",
  secondary: "",
  danger: "btn-error",
  ghost: "btn-ghost",
  dangerGhost: "btn-soft btn-error",
} as const;

/**
 * `btn-sm` rather than daisyUI's default size: these screens are dense — lists
 * with a row of controls on every line — and the full-size button is built for a
 * page with more room than any of them have. A caller wanting the bigger one
 * says so with `btn-md`, which comes after this in the class list and wins.
 */
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return <button {...props} className={`btn btn-sm ${VARIANTS[variant]} ${className}`} />;
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
      <input {...props} className={`input w-full ${className}`} />
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
 * A raised box on the page's ground: panels, dialogs, the sign-in card.
 *
 * daisyUI's `card` with an explicit border, which is what tells a `base-100`
 * panel from the `base-200` ground behind it in the light theme, where the two
 * are only a shade apart. No shadow and no padding: most callers want `shadow-sm`
 * and one — the turn bar — deliberately does not.
 *
 * `card` is a flex *column*, so a surface whose contents belong in a row has to
 * say `flex-row` and not merely `flex` — see `TurnControls`, where leaving it out
 * stacked the counter and the buttons up the middle of the bar.
 */
export const SURFACE = "card border border-base-300 bg-base-100";

/**
 * `scroll` keeps a panel inside the height its parent gives it and moves its
 * body's overflow into the panel instead, leaving the heading pinned. It only
 * means anything where the parent has a height to give — inside `AppPage`'s wide
 * layout — which is why the default is off.
 *
 * A panel with no `title` and no `actions` has no heading strip at all: a row of
 * controls that says plainly what it is does not need a word above it repeating
 * the point.
 *
 * Always a `<section>` with an `<h2>` inside it, whatever daisyUI's card markup
 * would prefer: that is the shape `tests/e2e.test.ts` finds a panel by, and it
 * is the right outline for the page besides.
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
 * daisyUI's `modal`, on a `<dialog>` for the role and the semantics — but held
 * open by the `open` attribute rather than by `showModal()`. A dialog opened the
 * native way is promoted to the browser's top layer, which sits above every
 * `z-index` on the page and would put the toasts *under* it; the whole point of
 * the ordering here is that a message about what just happened stays readable
 * over an open dialog. On the attribute it is an ordinary fixed element at
 * daisyUI's `z-index: 999`, and `Toast` sits deliberately above that.
 *
 * Escape closes it, which is ours to do for the same reason — the native handler
 * comes with `showModal()`. A click on the dimmed backdrop deliberately does not,
 * which is why there is no `modal-backdrop` form: these hold forms people are
 * part way through typing into, and losing that to a stray click is worse than
 * the extra press it costs to leave on purpose.
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
    <dialog open className="modal" aria-label={title}>
      <div
        className={`modal-box flex max-h-[90vh] flex-col overflow-hidden p-0 ${
          wide ? "max-w-5xl wide:max-w-7xl" : "max-w-lg"
        }`}
      >
        <header className={`flex items-center justify-between border-b px-5 py-3 ${HAIRLINE}`}>
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <Icon icon={faXmark} />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </dialog>
  );
}


/** The eight hover zones `hover-3d` needs, which are eight empty divs. */
const ZONES = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * A card that tilts towards the pointer: daisyUI's `hover-3d`, wrapped so the
 * three card libraries get it the same way.
 *
 * How the component works is worth knowing before changing anything here, because
 * it constrains the markup completely. `hover-3d` is a three-by-three grid of
 * exactly nine children: the first spans the whole grid and is the thing that
 * tilts, and the other eight are empty divs occupying the eight cells around the
 * middle. Those eight sit *above* the content at `z-index: 1` and exist only to be
 * hovered — which corner is under the pointer is read back out with `:has()` and
 * turned into the rotation. So they swallow every pointer event over the card, and
 * daisyUI says outright that buttons must not go inside the wrapper.
 *
 * Both of this app's ways out are here:
 *
 * - **The card's own click target is the wrapper**, not something inside it. A
 *   press on a zone bubbles up to the `<button>` that contains it, so the whole
 *   card is clickable while the zones keep doing their job. That is daisyUI's own
 *   advice — "wrap the entire component in a link" — and it is why `label` is
 *   required alongside `onClick`: the button's name has to be the card's subject
 *   rather than everything printed on it.
 * - **The corner controls are a tenth child.** `hover-3d`'s CSS only ever names
 *   `:first-child` and `:nth-child(2)` through `:nth-child(9)`, so a tenth is
 *   untouched by it and free to be positioned over the card at a `z-index` above
 *   the zones. It is laid out as a square over the picture rather than pinned to
 *   the card's bottom, so it lands in the same place whatever height the name
 *   below it turns out to need. The box itself passes the pointer through and only
 *   the buttons take it back, or it would blank out the tilt across the whole
 *   picture.
 *
 * The controls therefore stay flat while the picture tilts under them, which is a
 * deliberate trade: they are the card's chrome rather than part of its face.
 *
 * Anything else — a drag source, a drop target — goes on the outer `<article>`
 * through `...rest`, which is also what keeps `article:has(button[…])` working as
 * the way `tests/e2e.test.ts` finds a card.
 */
export function HoverCard({
  label,
  onClick,
  pressed,
  disabled,
  actions,
  cardClassName = "",
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  /** The card's accessible name. Required with `onClick`; ignored without it. */
  label?: string;
  /** What pressing the card does. Without it the card is not a control at all. */
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** Icon buttons laid over the bottom right of the picture, above the zones. */
  actions?: ReactNode;
  /** Border and background for the tile, which vary with selection. */
  cardClassName?: string;
  /** For the frame around the card: a drop target's ring, and nothing else. */
  className?: string;
  children: ReactNode;
}) {
  const tile = <div className={`${CARD_BASE} ${cardClassName}`}>{children}</div>;
  // `key` on a list of empties only to keep React quiet; they are interchangeable.
  const zones = ZONES.map((zone) => <div key={zone} />);

  return (
    // `flex` rather than `block`: `hover-3d` is an `inline-grid`, and an inline
    // box would sit on the text baseline with a descender's worth of gap under it.
    // A flex item is blockified instead, and fills the grid track it was given.
    <article {...rest} className={`relative flex ${className}`}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={pressed}
          // No display utility here, ever: `hover-3d` *is* the display, and a
          // `block` or `flex` alongside it would win and take the grid with it.
          className="hover-3d group w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tile}
          {zones}
        </button>
      ) : (
        <div className="hover-3d group w-full">
          {tile}
          {zones}
        </div>
      )}
      {actions ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex aspect-square items-end justify-end p-1"
          aria-hidden={false}
        >
          <div className="pointer-events-auto flex gap-1">{actions}</div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * A square button carrying an icon instead of a word.
 *
 * The label is required and never drawn: an icon on its own says nothing to a
 * screen reader, and it doubles as the tooltip.
 *
 * The one place in the app that still fixes its own colours, and deliberately:
 * this button is laid over a picture we know nothing about, so it cannot take a
 * theme token and stay readable. `neutral` is the darkest thing every theme
 * defines, and a translucent pill of it with its own content colour reads over
 * any photograph in either theme.
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
      className={`btn btn-square btn-xs border-0 bg-neutral/60 text-neutral-content shadow-sm backdrop-blur-sm ${
        danger ? "hover:bg-error hover:text-error-content" : "hover:bg-neutral/90"
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
 * only thing on the page rather than one empty box among several — and it carries
 * a spinner, because unlike an empty panel this one is genuinely waiting.
 */
export function LoadingNote({ children }: { children: ReactNode }) {
  return (
    <p className={`flex items-center justify-center gap-3 p-8 ${TEXT_MUTED}`}>
      <span className="loading loading-spinner loading-sm" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Distinguishes a PC from an NPC in lists where both appear. */
export function KindBadge({ kind }: { kind: "pc" | "npc" }) {
  return (
    <span
      className={`badge badge-xs font-semibold tracking-wide uppercase ${
        kind === "pc" ? "badge-info" : "badge-secondary"
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
      className="badge badge-xs badge-neutral font-semibold tabular-nums"
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
 *
 * `card-sheen` is the light the card catches as it tilts, and it is on the well
 * rather than on the tile because the well is what clips it: its `overflow-hidden`
 * is what keeps the highlight square to the picture and off the name underneath.
 * The rule itself is in `styles.css`, next to the tilt it moves with.
 */
export function CardWell({ children }: { children: ReactNode }) {
  return (
    <div className="card-sheen relative aspect-square w-full shrink-0 overflow-hidden bg-base-300">
      {children}
    </div>
  );
}

/**
 * What is actually in a card's well: the picture, or a stand-in icon when there
 * is none.
 *
 * Always decorative — every card puts the name in the strip underneath — so the
 * image carries no alt text and the placeholder is hidden outright. It used to
 * zoom gently on hover; `HoverCard`'s tilt is the movement now, and two scales at
 * once read as fidgeting rather than as one gesture.
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
      className="h-full w-full object-cover"
    />
  );
}

/**
 * A character's picture at list size, for the session screens.
 *
 * daisyUI's `avatar`, which is what a small square portrait beside a name is.
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
    <div className="avatar shrink-0">
      <div className="h-10 w-10 overflow-hidden rounded-md bg-base-300">
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
          over ? "border-primary bg-primary/10" : HAIRLINE
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
          className="file-input file-input-sm w-full"
        />
        <span className={`mt-2 block text-xs ${TEXT_MUTED}`}>
          {chosen ? `Ready to upload: ${chosen}` : "…or drop a file here."}
        </span>
      </div>
      {hint ? <span className={`mt-1 block text-xs ${TEXT_MUTED}`}>{hint}</span> : null}
    </label>
  );
}
