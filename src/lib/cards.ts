/**
 * How big a card may be drawn.
 *
 * One statement of the range, because four places need to agree on it: the
 * slider a game master drags (`client/components/Settings.tsx`), the schema that
 * checks what the slider sends (`lib/validate.ts`), the size uploaded pictures
 * are stored at (`lib/config.ts`), and the column default written into the
 * migration that added it. A range the server and the control disagree about is
 * a control that can ask for something the server will refuse.
 *
 * The numbers themselves: `min` and `max` are the sizes a card is worth being —
 * narrower than 100 and the name under the picture is unreadable, wider than 350
 * and a laptop shows four cards where it should show a wall of them. It is a
 * narrower range than the deployment setting used to allow, because a slider's
 * ends are a recommendation as much as a limit: every stop on this one is a size
 * somebody might actually want to play at.
 *
 * `default` is the size the deployment setting defaulted to — a card has always
 * been 176px, which is why `styles.css` still declares that and why the migration
 * writes it into every existing row. `step` keeps the slider on whole even
 * numbers, and is small enough that both ends and the default all land exactly on
 * a stop: 100 and 350 and 176 are each an even number of 2s from the bottom.
 */
export const CARD_IMAGE_PX = { min: 100, max: 350, step: 2, default: 176 } as const;
