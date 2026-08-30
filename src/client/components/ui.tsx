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

/**
 * A card's name, in the strip under its picture. Truncates rather than wraps.
 *
 * `card-name` is the hook for the deployment's own font, if it set one — see
 * `styles.css`, which falls back to `inherit` when it did not.
 *
 * `text-center` is for the truncated case alone: a name that fits is a shrink-
 * to-fit box that `CARD_CAPTION_FRAMED` centres itself, but one that is cut short
 * fills the strip, and without this its ellipsis would sit against the right edge
 * with the text left-aligned under a centred neighbour.
 */
export const CARD_NAME = "card-name truncate text-center font-medium";

/**
 * The shape shared by every card in the library — the tile itself, without the
 * behaviour, which `HoverCard` around it supplies.
 *
 * daisyUI's `card` gives the rounding and the surface; the rest is this app's.
 *
 * The card is a playing card: five wide by seven tall, with the top five of those
 * seven the square picture and the bottom two the name under it. So the ratio is
 * declared here, on the tile: the well takes its own width as a square
 * (`CardWell`) and what is left below it is two fifths of the width by arithmetic
 * rather than by a second number to keep in step. The name is laid over that
 * room rather than filling it (`CARD_CAPTION_FRAMED`), since it is drawn on the
 * panel the frame paints. A row of cards therefore lines up whatever the names
 * are, and a name too long for its strip is cut short rather than allowed to
 * make one card taller than its neighbours.
 *
 * `aspect-[5/7]` measures the border box, so five by seven is the card including
 * its frame; the picture inside is that less the hairline border on each side.
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
  "card flex aspect-[5/7] flex-col overflow-hidden border-[length:var(--card-border)] shadow-sm group-hover:border-primary group-focus-within:border-primary";

/**
 * Where a control may sit inside the frame's window, which is not the window
 * itself.
 *
 * The window — where the picture shows through — runs x 3.3%-97.0%, y 2.9%-63.9%.
 * Anything laid over the picture has to stay inside it: pinned to the square well
 * instead, a control would sit astride the gold divider the art draws at 64%,
 * since the well runs on to 71.4%.
 *
 * The controls stack down from the *top* right, and the right and top here are
 * pulled in from the window's own edges because that corner is bevelled — put in
 * the literal corner they would go under the frame. Measured on the dark template,
 * which is the tighter of the two: at x=95.5% the window does not begin until
 * y=5.0%, and its right edge only reaches 96.0% once past y=6.0%. Right 95.5% and
 * top 5.5% is the corner the stack fits into, and it is genuinely the corner: the
 * glyph clears the frame by about a pixel, and there is nowhere further to go.
 * Pull the right in much past this and the top icon is never clear at any height,
 * because the bevel has cut the corner away entirely by then.
 *
 * These are fractions of the card while the icons are a fixed 16px, so the two
 * scale against each other and the tight case is a *large* card, where the glyph
 * is a small enough fraction to sit right in the bevel's path. 4.4% is the value
 * that clears on both templates from a 112px card up to the 642px ceiling.
 *
 * The bottom is generous on purpose: the stack is laid out from the top, so this
 * only has to be far enough down not to squash it.
 */
export const CARD_WINDOW_CONTROLS =
  "left-[3.3%] right-[4.4%] top-[5.5%] bottom-[37.5%]";

/**
 * The name's strip on a card that carries the frame, which is not the same box.
 *
 * The card's own division puts the bottom two sevenths under the picture.
 * The artwork draws its panel somewhere slightly different — measured off the
 * asset, it runs from 67.8% to 96.2% of the card's height, with the gold divider
 * above it and the frame's outer border below — so this is positioned against the
 * art instead, and centred in the panel the art actually draws. Get this wrong
 * and the name sits on the divider or over the border rather than on the panel.
 *
 * No background: the artwork is the background now. And no colour of its own —
 * the light frame's panel is pale and the dark frame's is navy, so `base-content`
 * is right on both, and the app's rule that nothing names a colour survives a
 * card that is mostly picture.
 */
export const CARD_CAPTION_FRAMED =
  "absolute inset-x-0 top-[67.8%] bottom-[3.8%] z-20 flex items-center justify-center px-[8%]";

/**
 * The frame a card is printed in: `styles.css` holds the artwork and decides
 * which of the two themes' files to draw (see `--card-frame` there). `kind`
 * picks between the character art and the campaign art, which are cut to the
 * same 300x420 and so share every measurement here and in `CARD_CAPTION_FRAMED`.
 *
 * `pointer-events-none` says what is meant rather than doing any work: the tile
 * carries a transform and so establishes a stacking context, which confines this
 * below `hover-3d`'s hover zones however high its `z-index` — it could not
 * swallow a pointer event if it tried. Keep it anyway; the day the tile stops
 * being transformed, it is what stops the frame killing the tilt.
 *
 * It goes between the picture and the name — after `CardWell` and before the
 * `CARD_CAPTION_FRAMED` box — so the picture shows through its window and the
 * name is drawn on top of its panel.
 */
export function CardFrame({ kind = "character" }: { kind?: "character" | "campaign" }) {
  return (
    <div
      className={`card-frame ${kind === "campaign" ? "card-frame-campaign " : ""}pointer-events-none absolute inset-0 z-10`}
      aria-hidden
    />
  );
}

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
 * track, and the border and the name below it make the card taller. How much
 * taller is fixed now rather than a matter of the caption's contents: the card is
 * five by seven, so the track's width decides its height too (see `CARD_BASE`).
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
 * The scrolling body once reserved a scrollbar gutter whether or not it had a
 * scrollbar, so that its width never jumped. That reservation is gone. It cost a
 * card panel real room: the strip sits outside the grid's content box, so the
 * panel had to be a scrollbar wider than it looked before another card column
 * fitted, and the cards sat in twice as much padding on that side as on the other
 * three. What it bought was measurement stability for `useCardFit`, and that was
 * never in danger — pinning the panel to the columns it already holds cannot
 * change the column count, so it cannot change the row count, the body's height,
 * or whether the body scrolls at all.
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
        className={`p-4 ${scroll ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * The boundary between two panels, as a control.
 *
 * A window splitter in the ARIA sense: `separator` with a tabindex, which is why
 * it carries `aria-valuenow` and its two bounds — written to the DOM by
 * `useColumnSplit`, whose `handleProps` this takes, rather than rendered here, so
 * a drag does not re-render the page it is resizing.
 *
 * `hidden wide:flex`, because there is nothing to resize where the panels are
 * stacked: below the wide layout the handle is not drawn and is not in the tab
 * order either.
 *
 * It is exactly as wide as the gap it replaces (`w-3` for the `gap-3` the split
 * used to carry), so adding it moved nothing. What is drawn is a rail down the
 * middle of that gap rather than the whole box: the target is the full width, the
 * mark is a hairline, and the difference is the slack a pointer needs. `touch-none`
 * keeps a finger's drag from being read as a scroll of the page underneath.
 */
export function ColumnHandle({
  label,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div
      {...props}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className="group hidden w-3 shrink-0 cursor-col-resize touch-none select-none wide:flex wide:items-stretch wide:justify-center"
    >
      <div
        aria-hidden
        className="my-2 w-0.5 rounded-full bg-base-300 transition-colors group-hover:bg-primary group-focus-visible:bg-primary"
      />
    </div>
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
 * The controls sit outside the tilting tile, then, but they do not sit still: they
 * take the same rotation it does, so they read as printed on the card's face
 * rather than stuck to the glass in front of it. They cannot simply be moved onto
 * that layer — a transform makes it a stacking context, so anything inside it is
 * confined below the zones and no `z-index` will lift it back out, which is the
 * whole reason daisyUI says buttons must stay outside the wrapper. `styles.css`
 * has the arrangement, under `.card-3d`.
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
  /** Icon buttons laid into the top right of the picture, above the zones. */
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
    <article {...rest} className={`card-3d relative flex ${className}`}>
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
          className="card-actions-3d pointer-events-none absolute inset-0 z-20"
          aria-hidden={false}
        >
          {/* Two boxes, because they do two different jobs. The outer one is the
              card's own box and carries the tilt: a rotation about a shared centre
              maps a given point the same way whatever the box's size, so controls
              transformed here stay glued to a tile that is inset from it by the
              hairline border. The inner one is where the controls actually sit. */}
          <div className={`absolute flex justify-end items-start ${CARD_WINDOW_CONTROLS}`}>
            {/* The controls stack down the picture's top right, in the order they
                are given; no padding, because the box is already the corner the
                artwork leaves, and a tight gap because bare glyphs need less room
                between them than pills would. Every card in a library is framed —
                campaigns and characters alike — so there is one arrangement here
                rather than a choice. */}
            <div className="pointer-events-auto flex flex-col gap-0.5">{actions}</div>
          </div>
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
 *
 * `bare` drops the pill for the glyph alone, which is what the library cards
 * want so their controls can sit into the corner of the picture. It does not drop
 * the problem the pill was solving: a white glyph on a pale photograph is
 * invisible. So the job moves from a fill to a drop shadow, which costs no box.
 * Hover has to move with it — there is no longer a fill to change, so the glyph
 * brightens instead, and `danger` colours the glyph where the pill coloured
 * itself.
 *
 * The bare button is 16px around a 12.8px glyph, against the pill's 24px around
 * 16px. The margin is invisible and deliberate: without it the target would shrink
 * to the glyph itself. It is a small target even so — under the 24px that target-
 * size guidance asks for — which is the price of a control drawn as bare ink in
 * the corner of a picture.
 */
export function IconButton({
  label,
  icon,
  danger = false,
  bare = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  /** Just the glyph, for a control that sits on a card's picture. */
  bare?: boolean;
}) {
  const look = bare
    // Four fifths of the size these were: a 16px box, and the glyph scaled to match.
    // The glyph is shrunk with a transform rather than a smaller height and width,
    // because FontAwesome's own stylesheet sizes the svg and wins over a utility —
    // `h-4 w-4` is already on it and is not what decides how big it is drawn. A
    // transform is also the one thing that cannot be argued with by the cascade.
    // It is done here rather than by passing a smaller `Icon`, because the sheet
    // frame draws these same three at full size.
    ? `flex h-4 w-4 items-center justify-center text-neutral-content ` +
      // Two shadows, not one. The tight one is a halo that outlines the glyph, and
      // it is what keeps a pale icon legible on a pale picture — the case the pill
      // used to cover. The soft one lifts it off a busy photograph. A single soft
      // shadow reads well on a dark ground and almost disappears on a light one.
      //
      // Written as one arbitrary `filter` rather than two `drop-shadow-*`
      // utilities: those both set the same variable, so the second silently
      // replaces the first instead of composing with it.
      `[filter:drop-shadow(0_0_1.5px_rgba(0,0,0,0.95))_drop-shadow(0_1px_2px_rgba(0,0,0,0.7))] ${
        danger ? "hover:text-error" : "hover:brightness-125"
      }`
    : `btn btn-square btn-xs border-0 bg-neutral/60 text-neutral-content shadow-sm backdrop-blur-sm ${
        danger ? "hover:bg-error hover:text-error-content" : "hover:bg-neutral/90"
      }`;

  return (
    <button {...props} type="button" title={label} aria-label={label} className={`${look} ${className}`}>
      <span aria-hidden="true" className={bare ? "flex scale-[0.8]" : undefined}>
        {icon}
      </span>
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
 * `relative` because what sits over a picture is positioned against it: the
 * sheen's two layers, and whatever a caller overlays. It takes children rather
 * than a prop for each, since the three card libraries overlay different things.
 * The kind badge used to be one of them and is now on the name panel instead
 * (`CharacterCard`), and the corner controls are `HoverCard`'s, laid over the
 * card from outside the tile entirely.
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
