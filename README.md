# TTRPG Synchronizer

A private table companion. The game master keeps a library of campaigns and
character sheets, starts a session, and hands out a code. Players join with that
code, claim a character, and watch the table update live — who is in the scene,
what order they act in, whose turn it is, and which characters nobody has
claimed yet.

Built on Bun 1.4, SQLite, React 19, Tailwind v4 and daisyUI 5. One process, one
database file, no external services.

## Getting started

```bash
bun install
cp .env.example .env          # then edit it
bun run cli gm:add --email you@example.com
bun run dev                   # http://localhost:3000
```

Accounts are deliberately not manageable from the web UI — see the CLI below.

For local development over plain HTTP, set `INSECURE_COOKIES=1` in `.env`. This
drops the `Secure` flag from session cookies so they work without TLS. **Never
set it in production.**

## Command line

There is no account management UI, by design. Everything to do with game master
accounts happens here:

```bash
bun run cli gm:add     --email you@example.com [--password …]
bun run cli gm:list
bun run cli gm:edit    --email you@example.com [--new-email …] [--password …]
bun run cli gm:delete  --email you@example.com [--yes]
bun run cli db:migrate
```

Omit `--password` and you'll be prompted for it without echo — better than
putting a password in your shell history and the process list. Changing a
password signs out every browser that account was signed in on.

## How it fits together

```
src/
  server/    Bun.serve: JSON API, authorised file delivery, WebSocket
  db/        schema, migrations, and every SQL statement (queries.ts)
  lib/       config, logging, errors, validation, id generation
  cli/       game master accounts
  client/    React app
data/        SQLite database and uploads (gitignored, never served statically)
```

A few things are worth knowing before reading the code.

**The library watches the sessions it lists.** Each row in "sessions in progress"
opens that session's socket, so the turn and the player count follow the table
without a reload — the same snapshots the console gets, read for two numbers. The
list's own figures stand in until the first snapshot arrives, and again if the
socket drops. The rows sit in campaign
name order, since the campaign is the only name a session is shown under; sorting
by age instead reshuffled the list every time a session was started.

**And which sessions there are is live as well.** A session socket cannot carry
that: it is named after a session, and a session that has not started yet has no
socket to watch. So the library opens a second kind — `/ws?scope=library`,
authenticated as the game master and subscribed to a topic named after them —
and the server republishes the whole list to it whenever the list changes:
a session started or ended, a campaign renamed or deleted. The payload is what
`GET /api/sessions` returns, built by one function (`buildGmSessionList`), so a
list that arrived over the socket needs no separate handling on the client. Both
socket kinds share their connection machinery, including reconnect-with-backoff,
in `src/client/useLiveSocket.ts`; what differs is only how the messages are read.
Changes *inside* a session are deliberately not published here — each row already
follows its own session — so a busy table does not rebuild the whole list on
every turn.

**A player is present for as long as they are connected.** Closing the tab is how
people actually leave a table — few of them find the button first — and someone
who is gone still holds their character, so the seat has to come free on its own.
But a socket closing is not the same as a player leaving: a reload, a dropped
tunnel, or a phone locking itself close it too, and the client comes straight
back. So a closed socket only starts a clock (`PLAYER_GRACE_MS`, 30 seconds by
default), any new socket for that player stops it, and only a player who is still
absent when it runs out is removed — releasing their claim and republishing the
session. The asymmetry is deliberate: dropping someone who was reloading takes
their character away mid-scene, while holding a seat a little too long is a stale
row in a list. An ended session is exempt, keeping the roster it finished with.

Since a removed player's socket is refused rather than told why, a page that was
left open would otherwise retry behind "Reconnecting…" for ever. While the socket
is away, the player screen asks `/api/auth/me` who it is; an answer that is no
longer this player means the seat is gone, and it says so instead of spinning.

**Every change republishes the whole session.** Rather than sending diffs, any
mutation recomputes a complete snapshot — session, players, the stage in the
order it acts — and publishes it to everyone watching. The lists are a dozen rows
at most, and it means a client can never merge updates in the wrong order: a
character arriving racing a turn change cannot leave someone highlighting the
wrong row.

**One live session per campaign.** Two would give the same characters two
clocks and two turn markers, and a code would not say which table a
player had joined. The rule is a partial unique index on `game_sessions`
(`002_one_active_session_per_campaign.sql`) covering active rows only, so a
campaign can still be played again and again; the start handler checks first and
answers 409 with something a game master can act on, and the index is what makes
that check impossible to get around.

**A session opens with the party in it.** Starting one inserts every PC in the
campaign onto the stage in a single statement, inside the same
transaction that creates the session — `sessionCharacters.addCampaignPcs` in
`src/db/queries.ts`. Characters already in the session are filtered out of that
statement rather than left to `ON CONFLICT DO NOTHING`, because a skipped row
would leave a hole in the positions.

**The fight runs on the HERO clock, and the clock lives on the server.** A Turn
is twelve segments; SPEED says which of them a character acts in, off the Speed
Chart in `src/lib/hero.ts`, and DEX+INIT says who goes first inside one. The
session carries `turn` and `segment` alongside `active_slot_id`, and `advanceTurn`
(`src/server/routes/sessions.ts`) is the only thing that moves any of the three —
so two open game master tabs cannot come to different views about where in the
fight the table is. Stepping forward takes the next character acting in this
segment, or else the first character of the next segment anybody acts in;
segments with no phases in them are stepped straight over rather than shown empty.

The turn counter goes up on *arriving at segment 1*, not on passing segment 12,
which is what makes a fight open on Turn 1 Segment 12 and the first Segment 1
belong to Turn 2. That is how HERO starts a combat, and it reads as an off-by-one
without being one. A SPEED of nought is an empty row of the chart, so a character
nobody has filled in never comes up on turn — and a stage where *nobody* has a
SPEED is refused outright with something the game master can act on, since the
segment walk would otherwise have all twelve to search and nothing to find.

**Crossing segment 12 hands everybody a Recovery.** HERO gives every character in
a fight a free Recovery once the twelfth segment is done, so the step that takes
the clock from 12 round to 1 takes it for the whole stage — NPCs included, since
the rule is about characters rather than about who is playing them — before the
snapshot goes out. It is one `UPDATE` over the stage (`takeRecoveryAll`) sharing
its arithmetic with the single-slot Recovery button, so the two cannot come to
disagree about what a Recovery is, and the stage recovers all at once or not at
all. `advanceTurn` answers whether it happened, and the route then publishes a
`notice` on the session socket — an event rather than state, kept out of the
snapshot so a client reconnecting an hour later is not toasted about it — which
every screen in the session, the game master's included, shows as
`Post-Segment 12 Recovery`. `Previous` never takes one: it retraces the path so
the game master can correct a click, and a Recovery already taken is not untaken.

The Speed Chart is written out longhand rather than derived. It is a published
table, not a formula: the segments SPD 7 gets are not the segments an even spread
of seven phases would give, and a clever reconstruction that came close would be
wrong exactly where nobody checks. `tests/hero.test.ts` pins every row of it.

**Restarting the fight clears the turn rather than parking it.** `POST
/api/sessions/:id/turn/restart` sets the clock to Turn 1, Segment 12 and the
active slot to `null`, which is the state a session opens in — "No turn set yet",
with the first press of Next opening segment 12 on whoever leads it. Putting the
marker on the first character instead would look equivalent and is not: the stage
may well have changed since the fight began, and it would quietly decide the new
leader had already acted. Nothing else is touched, so the stage and the players'
claims both survive a restart; it restarts the fight, not the session. The button
asks first (`Confirm.tsx`), since it is the one turn control that throws work away
and the only way back is to press Next as many times as it took to get there — and
it is disabled outright at turn one with no turn set, where there is nothing to go
back to.

**Every picture comes from one set.** Icons are FontAwesome v7's free solid
icons, imported one at a time from `@fortawesome/free-solid-svg-icons` and drawn
as inline SVG by `Icon` (`src/client/components/ui.tsx`) — so nothing is fetched
at runtime, there is no webfont, and the page's `default-src 'self'` policy needs
no exception. `main.tsx` sets `config.autoAddCss = false` and imports the
library's stylesheet instead, because it otherwise writes a `<style>` element
into the head the first time an icon renders, and every other stylesheet here is
bundled. Sizes stay Tailwind's (`h-4 w-4`) rather than the library's own `size`
prop, since the buttons were measured against those classes.

Icons are always decorative: each one sits in a button carrying its own
`aria-label` and `title`, or inside a wrapper already marked `aria-hidden`, so a
picture is never the only thing saying what a control does. That is also why the
turn controls kept their words — the icon replaced the arrow beside `Previous`,
not the label. The free icons are CC BY 4.0, © Fonticons, Inc.

**A destructive control in a list is a variant, not a red `className`.** `Button`'s
`dangerGhost` (`src/client/components/ui.tsx`) is the quiet form of `danger`:
daisyUI's `btn-soft btn-error`, a faint red wash rather than a fill, for "End
session" in the library's list and "Kick" in the players panel, where one filled
red button per row would drown the row it belongs to. It exists as a variant
because the obvious shortcut — `variant="ghost"` with a red `className` —
silently does not work: both set `color`, and which utility wins is decided by
the order Tailwind emits them in rather than by the order the caller wrote them,
so those buttons rendered grey. The same hazard the drop-target ring avoids, in a
different property.

**Nothing is deleted out from under a running session.** A character on the stage
of a live session cannot be deleted; `DELETE /api/characters/:id` answers 409 and
says which way out to take. Without the guard the `ON DELETE CASCADE` on
`session_characters.character_id` would do it silently — the character would
disappear from the players' screens mid-fight on the next broadcast, and the
stage would be left with a hole in its positions, since a cascade removes rows
without renumbering `position` the way `sessionCharacters.remove` does. The guard is
`sessionIdsWith` (`src/server/session-state.ts`), the same check that already
refuses to refile a character out of a campaign they are playing in; it filters on
`status = 'active'`, so an ended session is history and a character merely filed
under a busy campaign is still deletable. Refusing the operation is what closes the
dense-position hazard, rather than any renumbering code: the cascade can no longer
fire on a stage anyone is looking at.

**The stage is a list of slots, not of characters.** A fight usually has more than
one goblin, so `session_characters` rows carry an id of their own and two of them
may name the same character. That id is what the turn marker points at
(`game_sessions.active_slot_id`) and what a removal names — because "remove
Strahd" stopped being a question with one answer. It is also the `id` in the
snapshot, so every id-keyed thing on the client — React keys, `Go now`,
`Remove` — kept working and simply means the slot now; the
character it shows rides alongside as `characterId`, which is what a claim and a
sheet are about. The one place this had to be watched is `advanceTurn`: matching
the marker on the character would find the first goblin every time, so the marker
would spring back to it and the other two would never act.

**A copy's number is a name, not a position.** `copy_number` is stored, assigned as
one more than the highest that session has ever used for that character. Remove
Goblin 2 and you are left with Goblin 1 and Goblin 3, and the next one along is
Goblin 4. Deriving the number from the row's place in the order would have been
less to store and wrong at the table: the number would change when another copy
died or the order was dragged about, and someone tracking a monster's wounds on
paper needs the label to stay put. The number is only drawn while there is a second
copy to tell it apart from — a lone goblin is just the goblin — which is
`stageLabel` in `InitiativeList.tsx`, shared with the turn banner so the two can
never disagree about what the monster on turn is called.

**Only NPCs repeat.** A PC added twice is a no-op: `sessionCharacters.add` takes the
character's kind and refuses a second slot for a hero. Two would give one player two
seats and break the one-claim-per-character rule the players table enforces, and a
party does not have two of the same hero in it. That is also what lets claims stay
keyed on the character rather than the slot, which is the reason the whole player
side of this — claiming, "Playing as", the sheet check — needed no schema change at
all.

**The order is derived, not stored.** `sessionCharacters.list` sorts by
`dexterity + initiative` descending, which is what HERO runs a segment in, and
`session_characters.position` survives only as the tiebreak between two characters
on the same DEX+INIT: it is the order they came on stage. Sorting at read time
rather than writing positions when a character walks on is what keeps the panel
right the moment a DEX is edited mid-session — a stored order has somewhere to
drift to, and this has nowhere. `position` is still dense `0..n-1`, since adds
append and removes close the gap, so the tiebreak stays a real sequence.

**The segment filter is one reader's own.** The button on the segment panel narrows
it to the characters acting in the current segment, and both audiences get one:
which rows a game master would rather not scroll past is not a fact about the
session, so it is never broadcast and never reaches anyone else's screen. It lives
in `sessionStorage`, keyed by session (`SegmentFilter.tsx`) — it should survive a
reload mid-fight and it should not still be set months later at another table. It
is one setting rather than one per segment, so it stays on as the fight walks the
clock. Turned off, a character with no phase this segment is dimmed rather than
hidden: their STUN is still the game master's to change on a segment they are not
acting in.

**A status tag hangs off the slot, one row per tag.** Prone, stunned, dead and
the rest are facts about this copy in this fight — one goblin can be face down
while its twin is swinging — so `session_character_tags` keys on the stage slot
and cascades with it: taking a copy off the stage takes its conditions with it
and needs no cleanup code. The primary key is `(slot, tag)`, which is the rule
itself, since a character is prone or is not and being told twice is not two
pronenesses. The write is `PATCH /api/sessions/:id/stage/:slotId/tags` carrying
`{ tag, active }` — the state the tag should end in, not an instruction to flip
it — so a retried request or two people reaching for Prone at once leaves one
prone character. It is the fourth route `requireSlotAccess` guards: the game
master may tag anybody in the scene, a player only the character they claimed.

The eight the app knows by name live in `src/lib/hero.ts` beside the
characteristics, which is what feeds both the zod schema and the labels; the
pictures for them are in `src/client/components/StatusTags.tsx`, because
`hero.ts` is read by the server and FontAwesome is the browser's business.
Anything else a table wants to track is typed, kept as typed, and drawn with a
generic mark and its own word — with the one twist that a typed "Prone" folds
onto the button's `prone` rather than becoming a second kind of prone. The
column is `COLLATE NOCASE` for the same reason, and the table deliberately
carries no `CHECK`: what a tag may be is decided by the schema on the way in,
where every other such rule lives.

Both audiences read the tags off the segment panel — who is stunned is what the
table is looking at when it decides what to do next — but only a reader who may
write a row gets the control that opens the picker. That is the same split as
the numbers, drawn the same way: the game master's list is passed the callback,
a player's is not, and a player sets their own character's conditions on their
`My character` panel instead. The pills are icon-only with the name in the
tooltip and in an `sr-only` span, since a row already carries a name, a kind, a
count and four characteristics.

**Card styling is shared.** The campaign and character grids are different
components, so their shape lives in one place — `CARD_BASE` in
`src/client/components/ui.tsx` — and the player's character picker is built from
the same two, so a player sees the shape the game master saw. The picture is the
square, not the card: the image well is a full-width square, the card's controls
ride on the picture as icons in its lower right corner (`IconButton`) — edit,
delete, and on a character card one that opens its sheet — and the name sits
under it on its own. That keeps the card mostly picture, and since every caption
is built the same way a row still lines up whatever the names are. An icon button
always carries a label — it is the tooltip and the only thing a screen reader has
to go on. Every hover rule is paired with a `focus-within` one, because a card is
a box of buttons and a keyboard user would otherwise get no feedback at all.

**A card tilts towards the pointer, and that decides its markup.** `HoverCard`
(`ui.tsx`) wraps daisyUI's `hover-3d`, which is a three-by-three grid of exactly
nine children: the first spans the whole grid and is what tilts, and the other
eight are empty divs occupying the cells around the middle. Those eight sit
*above* the content at `z-index: 1` and exist only to be hovered — which corner
the pointer is in is read back with `:has()` and turned into the rotation. They
therefore swallow every pointer event over the card, and daisyUI says outright
that buttons must not go inside the wrapper. Every card here is a box of buttons,
so both of the ways out are in `HoverCard`:

* **The card's own click target is the wrapper.** A press on a zone bubbles up to
  the `<button>` containing it, so the whole card is pressable while the zones
  keep working — daisyUI's own advice, "wrap the entire component in a link". It
  is why `label` is required beside `onClick`: left to compute its own name, the
  button would be called after everything printed on the tile, kind badge
  included, and `tests/e2e.test.ts` looks a character up by its name exactly.
  This is also what retired the two full-bleed buttons that used to cover a
  card's picture — selecting a campaign, and opening a character — since the card
  itself is now the control.
* **The corner controls are a tenth child.** `hover-3d` only ever names
  `:first-child` and `:nth-child(2)` through `:nth-child(9)`, so a tenth is
  untouched by it and free to sit above the zones. It is laid out as a square over
  the picture rather than pinned to the card's bottom, so it lands in the same
  place whatever height the name below it needs, and the box passes the pointer
  through with only the buttons taking it back — otherwise it would blank out the
  tilt across the whole picture. The controls stay flat while the picture tilts
  under them, which reads as chrome on top of the card rather than part of its
  face.

Two consequences worth knowing before editing `CARD_BASE`. It carries **no
`transform`, `transition` or hover shadow** — `hover-3d` sets all three on that
same element, and a Tailwind utility for any of them silently wins (Tailwind's
utilities are unlayered within `@layer utilities`; daisyUI's are in a sublayer),
which would simply stop the tilt. The lift the cards used to have is what the
tilt replaces. And its hover colours are **`group-` variants**, because the
pointer is never over that element at all: the zones cover it and are its
siblings, not its children, so its own `:hover` never fires. The group is the
`hover-3d` wrapper, which the zones *are* inside.

**The card also catches the light as it tilts**, and that too is daisyUI's, only
turned up. `hover-3d` sets a `--shine` beside the `--transform` it rotates by —
`0% 0%` for the top left zone, `200% 200%` for the bottom right, `100% 100%` at
rest — and draws a blurred pool of light there. At `#fff3` under an opacity fade
it is invisible in practice, so `styles.css` restates it at a strength that
reads, and adds the diagonal glare band daisyUI's hover rule already anticipates
(`&:before, &:after`) but never defines. Both layers are one cell of the same
three-by-three grid the zones form, so the light lands on the cell the pointer is
in by construction, and moves in the same nine steps the tilt does.

It lives on `CardWell` rather than on the tile, which is what clips it: the
well's `overflow-hidden` keeps the highlight square to the picture, so no streak
ever crosses the name below and its contrast is untouched. daisyUI's own
tile-level `::before` is switched off with `content: none` so there are not two
of them, and the hover state is restated locally because these rules are
unlayered and would otherwise beat daisyUI's `opacity: 1`. The strength is two
custom properties, `--card-sheen` and `--card-glare` — the one place in the app
that names a colour, since a specular highlight is light falling on the card
rather than a colour from the palette. How glossy a card should look depends on
the artwork a table uses and the screen it is read on, so the deployment scales
both with `CARD_SHEEN_PCT` (100 is the tuned strength, the default is a quarter
of it, and 0 turns the highlight off), which
arrives as `--card-sheen-strength` through `/appearance.css` exactly as the card
size does. The two percentages stay in the stylesheet, so the balance between the
hotspot and the band survives whatever the setting is.

Under `prefers-reduced-motion`, the card does not move and does not shine.
Zeroing transition durations is not enough — it would turn the tilt into a snap,
which is worse than the slide — so `styles.css` neutralises the transform
outright and drops the sheen's pseudo-elements, unlayered so it beats daisyUI's
own rule. The hover border still says which card the pointer is on.

**Colour belongs to daisyUI, not to the components.** `src/client/styles.css`
enables two of its stock themes — `winter` for light and `night` for dark — and
every component is written against the semantic tokens they define: `base-100`
for a panel, `base-200` for the ground it sits on, `base-300` for an inert well,
`base-content` for text, and `primary` / `error` / `warning` / `success` / `info`
/ `secondary` for the six things that mean something. Nothing in `src/client`
names a palette shade, and nothing carries a `dark:` twin — the theme decides
what each token resolves to, so dark mode stopped being per-utility work. A
`grep` for `stone-`, `amber-` or `dark:` over the client is the check that this
still holds; it should find nothing but prose.

Components come from daisyUI too: `btn`, `card`, `badge`, `alert`, `input`,
`select`, `file-input`, `modal`, `join`, `avatar`, `loading`. What is left in
`ui.tsx` is the handful of decisions daisyUI has no opinion about.

**The theme control has three states for two themes.** Light and dark are the
themes; "system" is the *absence* of a choice, and it is handled entirely in CSS
— `winter --default` applies at `:root`, `night --prefersdark` applies inside a
`prefers-color-scheme: dark` query when no `data-theme` attribute is set. So a
reader who never touches the toggle gets a correct first paint with no script
involved. An explicit choice writes `data-theme` onto `<html>` and is remembered
in `localStorage` under `ttrpg.theme`; `initTheme()` applies it before React
renders so a stored choice never flashes the other theme. What is *stored* is the
preference ("light"), and what is written to the attribute is the theme that
realises it ("winter") — `THEMES` in `src/client/theme.ts` is the only place that
knows which stock themes were picked, so swapping one leaves every reader's
stored preference intact. That split is also why the toggle is a `join` of three
buttons rather than daisyUI's `theme-controller` radio, which has no way to
express "no attribute".

Two of its habits are worth knowing before adding a control. **Its form controls
are `width: 100%` by default** — a `select` dropped into a flex row will take the
whole row and squeeze its siblings to nothing, which is why the one in the GM's
player list carries `w-auto`. And **its `error`, `warning` and `success` are pale
by design**, meant to be washed behind text or filled behind their own `-content`
pair; a number or a caption drawn in one of them on the light theme is barely
there. Where a colour has to carry meaning *and* be read, the tone goes on the
border and the wash and the text stays `base-content` — see `TONES` in
`Vitals.tsx` and the unclaimed row in `InitiativeList.tsx`.

**And so are the shapes the screens repeat.** `ui.tsx` names them once —
`TEXT_MUTED`, `SURFACE`, `HAIRLINE`, `FIELD_CAPTION`, `PANEL_CAPTION` and their
neighbours — and the pieces of markup that repeat are small components beside
them: `CardWell` and `CardPicture` for a card's square picture, `CountBadge` for
"how many of this one", `LoadingNote` for a screen with nothing to show yet.
Before that, the muted-text classes alone were written out in eighteen places,
and a change to them meant finding all eighteen.

These are exported class *strings* interpolated into `className`, not CSS classes
built with `@apply`. That is what Tailwind itself recommends for a React codebase,
and it keeps every class in the app inside one mental model: when two of them set
the same property, which wins is decided by the order Tailwind emits them in, and
that rule holds for a constant exactly as it does for a literal. **So a constant
deliberately leaves out any property its callers disagree about** — `SURFACE`
carries no shadow because the turn bar wants none, `PANEL_CAPTION` carries no font
size because its five users pick five different ones. A call site that has to
override what it just applied is the bug this shape exists to prevent; write the
classes out longhand instead, as the small select in the GM's player list does.

**So is the grid the cards sit in.** `CARD_GRID`, alongside it, lays them out on
a fixed-width track rather than a fraction of the panel. The two libraries sit in
panels of different widths, and anything proportional makes a campaign card and a
character card come out different sizes; a fixed track makes them identical at
every window size, at the price of some slack at the end of a row.

**The campaign panel gives that slack away.** On the wide layout it is trimmed to
the width that holds a whole number of card columns and no part of another, so its
edge sits flush against the last column and the character panel beside it takes
what is left. `useCardFit` (`src/client/useCardFit.ts`) measures the panel, works
out how many columns its natural share holds — never more than there are campaigns
to fill them, never fewer than one — and writes that width into `--campaign-col`,
which the split's grid template reads (`styles.css` declares the fluid default, so
unpinned it is the ordinary `1 : 1.4` split). It only ever narrows: what the
campaign panel gives up, the `1.4fr` next to it absorbs. Nothing there assumes a
card size, a gap or a padding — all of them are read back from the rendered
layout, so a deployment drawing larger cards needs no matching change. The
scrolling panel body keeps a stable scrollbar gutter for the same reason: the
measurement has to mean the same thing before and after the panel is trimmed.

**File fields take a drop, and still are file fields.** Adding a character means
handing over an HTML sheet and often a picture, and dragging a file from a folder
is the shorter path — so both fields on the character form are `FileDrop`
(`src/client/components/ui.tsx`), a dashed zone that names the file once it has
one. The native `<input type="file">` stays inside it rather than being replaced
by a div: it is what a keyboard reaches, what the `accept` filter belongs to, and
what `FormData` reads on submit. A drop copies the file into that input through a
`DataTransfer`, so the form submits exactly as it did before the zone existed and
knows nothing about any of this. Dropped files are not type-checked in the
browser — the server identifies an image by its magic bytes, not by what the
client called it, so a wrong file comes back as the same error the picker would
have produced. The sheet field leads the form, ahead of the name: handing the
file over is what the dialog is for, and everything under it — name, type,
campaign, picture — is filing the thing that was just uploaded.

That ordering is also what makes the name fill itself in. A sheet is nearly
always saved under the character's name, so uploading `Bilbo Baggins.html` puts
"Bilbo Baggins" in the field below it — the extension goes, and nothing else
about the filename is second-guessed. It writes only into an empty field or over
a name the last upload put there, tracked in a ref: a second file replaces its
own suggestion, but never a name the game master typed, and never the name of a
character being edited.

The panel behind the dialog is a drop target too: a sheet dropped anywhere on
"Characters in …" opens the add dialog already holding it, so a folder of sheets
can be filed without opening the dialog first each time. Both targets are the
same three handlers — `useFileDropTarget` in `ui.tsx` — and the file reaches the
dialog as `initialFile`, which puts it through exactly the path a drop on the
field itself takes, so the name fills in and the form submits with no idea where
the file came from. `Panel` learns nothing about files: it spreads unknown props
onto its `<section>` the way `Button` does, and the highlight is a `ring`, since a
border or background utility would fight the panel's own for the same property
and let stylesheet order decide the winner. The page also swallows `dragover` and
`drop` at the window: having invited a drag, a miss must not make the browser
navigate away to render a character sheet as a bare page.

**A drop target names what it accepts.** `useDropTarget` (`ui.tsx`) is keyed on a
`dataTransfer` type — `"Files"` for the file fields and the character panel,
`CHARACTER_DRAG` for a campaign card — and a drag carrying anything else is left
entirely alone: not `preventDefault`ed, so it passes through to whatever is behind
and the browser draws a no-drop cursor rather than an invitation the element cannot
honour. That one guard is what lets card drags and file drags share a page: before
it, the character panel claimed every drag that crossed it, so a character dragged
back onto its own panel opened the add dialog as though a sheet had arrived. The
window-level swallow is narrowed the same way, for the same reason.

**Dragging a character onto a campaign refiles it.** Both libraries are on screen
together on the wide layout, so the shortest way to move a character is to drop its
card on the campaign it belongs to. It is native HTML5 drag: the two panels are
separate `overflow-y-auto` scroll
containers that would clip a dragged card, and the accessible path here already
exists — the edit dialog's campaign field — so the drag is an accelerator rather
than the only way in. During `dragover` the payload is unreadable, only its type, so
`GmLibrary` holds the dragged character in state as well: a campaign card has to know
while the drag is still in the air whether letting go would move anything, and the
card of the campaign the character is already in stays dark. The cue on the one that
would take it is a ring with an offset — a different shape from both the selection
ring a campaign card may already wear and the ring the character panel draws for a
file, so the three never read as each other.

The selection does not follow the character: it leaves the list and the panel stays
where it was, so a run of characters can be filed out of one campaign without
re-selecting it between each. Two rules are the server's, since they are about the
data rather than the gesture. A name is unique within a campaign, so the PATCH asks
whether the character's *effective* name and campaign collide rather than which
fields the form carried — a move alone can collide just as a rename can, and a drop
sends nothing but the campaign. And a character playing in a session that is still
running cannot be moved at all: refiling it would leave it in the running session of
a campaign it no longer belongs to, which is not something the players could make
sense of, so the drop is refused and says to end the session first.

**A sheet usually contains the portrait already.** Sheets are self-contained
files, so the character's picture is already inside the HTML — and asking the
game master to find and upload the same image a second time is work the app can
do itself. `portraitFromSheet` (`src/server/uploads.ts`) reads the stored sheet,
decodes what is embedded in it and keeps the largest image, which is stored as an
ordinary image upload and becomes the character's picture.

It looks for encoded bytes rather than for markup, because there is no agreeing
on the markup: the same picture turns up in an `img` tag, in a CSS `url()`, and
in a string a script assigns to `.src` at load time — that last one with no
`data:` prefix anywhere in the file, just a long hex or base64 literal in a
variable. So both encodings are scanned wherever they appear, and what identifies
an image is what identifies every other upload: the bytes it starts with. Only
the first few bytes of a candidate are decoded to decide that, since a sheet is
full of long runs that are really a hash, a minified bundle, or an embedded font;
megabytes are decoded only once the run is known to be an image. There is no
convention for *which* image is the portrait either, but a portrait is reliably
bigger than the dice icons and rules diagrams around it; anything under 2 KB is
skipped as furniture.

Two rules hold it in place. **Images linked by URL are never fetched.** Following
a `src` an uploaded file names would let that file steer a request from the
server, at whatever address it likes — the whole of SSRF — so only what is
embedded in the sheet is considered. And **a picture the game master chose is
never overruled**: an image uploaded in the same request wins, a new sheet fills
an empty picture but never replaces an existing one, and a failed scan is logged
and forgotten rather than failing the upload, since a portrait nobody asked for
is not worth an error.

**How big a card is, is a deployment setting.** `CARD_IMAGE_PX` (default 176)
measures the *picture* on a card; the frame around it and the name underneath
make the card itself larger. Getting that number into the browser takes a small
detour: the client is a bundle built when the server starts, so the value cannot
be compiled in, and fetching it as JSON would draw the first cards at one size
and then resize them. Instead the server serves a two-line stylesheet
(`server/routes/appearance.ts`) declaring `--card-image-size`, which is what the
card grid is measured in — so nothing needs to re-render when it lands, and no
component has to know the setting exists. `styles.css` declares the same property
with the default, so a page whose request for it fails is still laid out
correctly. The link is attached by `client/appearance.ts` at startup rather than
written into `index.html`, because Bun resolves the document's links at build
time and this one only exists at run time.

The grid track adds the card's border back on (`--card-border`), so the picture
is the size that was asked for rather than two pixels short of it — the one place
those two variables meet, and the reason the border width is a variable at all.

**Pictures are stored at the size they are looked at.** Every image the app shows
— a campaign's, a character's, and the portrait lifted out of a sheet — ends up
in a square card 176px across, so keeping the 4000px photograph that was uploaded
costs a game master's phone several megabytes to draw a thumbnail. `fitToCard`
(`src/server/uploads.ts`, on the path every image upload takes) scales the
**shorter** side down to `limits.cardImagePx`, since that is the side that has to
cover a square. Nothing is cropped: the card takes its square at display time,
and the rest of the picture is still in the file for anywhere it is shown
differently. Nothing is enlarged either, and an image already small enough is
stored byte-for-byte as it arrived rather than re-encoded for no gain — as is one
whose bytes sharp cannot read, since it passed the magic-byte check and a game
master would rather have their picture at full size than an error. The format is
never changed, and an animated GIF is resized whole rather than flattened to its
first frame.

This is the one thing in the app that needs a real library: `sharp`. It is a
native binding, which is a heavier dependency than anything else here, and it is
worth it — decoding and rescaling four image formats correctly is not something
to hand-roll.

**Asking before something irreversible is the app's own dialog.** Deleting a
campaign or a character, ending a session and removing a player all ask first,
and none of them uses `window.confirm`: the browser draws that in its own chrome,
so it arrives in the wrong typeface, ignores light and dark entirely, and shows a
name in curly quotes in whatever font the chrome happens to use. `ConfirmProvider`
(`src/client/components/Confirm.tsx`) puts the question in the same `Modal` every
other dialog uses, and hands the caller a promise, so the guard at the top of a
handler stays the one line it was — `if (!(await confirm({…}))) return;` — rather
than each route growing its own piece of open-question state. It is a provider for
the reason `ToastProvider` is one: the answer has to outlive the click that asked
for it. The one-line native message becomes a title and a body, the button that
goes through with it carries the verb rather than "OK" so it still says what will
happen when read on its own, and Escape, the ✕ and Cancel all mean no — the answer
a dialog dismissed by accident should give. It sits at `z-40` like `SheetOverlay`,
under the toasts at `z-50`, so the message about what just happened is still
readable over it.

**A page takes the whole window.** `AppPage` used to centre a column capped at
`max-w-6xl`, which is right for prose and wrong for panels of lists: a tall
monitor — wide enough for two columns, too tall to count as a dashboard by the
`wide` variant below — left two thirds of the glass empty while a panel inside it
needed a horizontal scrollbar. There is no cap now, and no page-level scroller;
where a row is genuinely tight it is the row that draws tighter, as `Vitals` does
by narrowing its boxes and gaps below `sm`.

**Wide screens get a dashboard, not a document.** A 16:9 monitor is much shorter
relative to its width than a phone, so a page that stacks its panels makes the
game master scroll away from the turn tracker mid-turn. A `wide` variant in
`src/client/styles.css` — keyed on the aspect ratio as well as the width, so a
portrait monitor is left alone — switches the session and library pages to a
frame exactly one viewport high, panels side by side, each scrolling its own
list. `AppPage` and `Panel`'s `scroll` prop in `src/client/components/ui.tsx`
carry this; the routes only choose how the panels divide the frame, and — on both
session pages, with `order` rather than a second copy of the markup — what
sequence they sit in once there are columns. The console goes one column, to two
equal halves, to three equal thirds, and the turn travels with the segment
panel the whole way: it is the same fight, so it sits above it and shares its
width rather than running the width of the page. The code travels with the
players in the same way — and stacked, `order-first` lifts it above everything,
since handing out the code is the first thing a game master does. On the player's page the column
wrappers are `display: contents` until the columns exist, so the four panels are
items of one column while stacked and `order` alone moves the player list below
the scene; nothing there grows, so a short list ends where its content does
instead of being stretched to the frame, and `scroll` is left on the two lists
only to catch the opposite case. Anything narrower or taller keeps the stacked
layout unchanged.

## Two kinds of number

A character carries seven HERO System characteristics, and three of them are
recorded twice. On the character they are the total — what SPEED, DEXTERITY,
INITIATIVE, RECOVERY, ENDURANCE, STUN and BODY *are* — and they change only when
the game master edits the library. On a stage slot, ENDURANCE, STUN and BODY are
recorded again as what that copy has left right now.

INITIATIVE is the odd one out and is deliberately its own column rather than
part of DEXTERITY: it is whatever moves a character up the order that DEX does
not already explain — Combat Reflexes and its like — and DEX has to keep meaning
DEX everywhere else it is read. It is the one characteristic whose name does not
explain itself, so it is also the one with hover text, which is why
`HERO_STAT_HINTS` sits beside the labels in `src/lib/hero.ts` rather than as a
string in the form.

The split is what makes two goblins two monsters. A slot is seeded from the
character's totals as it walks on (`sessionCharacters.add`, and the same columns
in `addCampaignPcs`) and is its own number from then on: one goblin beaten down
to 3 STUN stays there when its twin joins the fight, and a correction to the
library mid-session moves the total without healing anybody.

Which is why the totals live on `presentCharacter` — they are the character's,
and the REST character routes want them too — while the current values are added
in `buildSnapshot` (`src/server/session-state.ts`) beside the other things that
are true of a slot rather than of a character.

Who may read them is the same question as who may write them, which is why the
segment panel gates both on one prop: the game master's list is handed
`onSetVitals` and draws every row's numbers, a player's list is not and draws
none. What the monster has left is the game master's information to give out or
hold back at the table, and a player's own numbers are on their `My character`
panel rather than a second time in the scene.

The looked-up four — SPD, DEX, INIT and REC — divide the same way, on `editable`:
the game master's rows carry them, since the segment panel is where the order is
worked out and those are what it is worked out from, and a player's rows carry
who is playing what instead. `StatLine` draws that line for both the game
master's rows and a player's own character panel, so the numbers are written
identically wherever they are read — the counterpart to `Vitals` for the three
that are spent.

**A box asks for the change, not the total.** What anyone at the table says is
"that's eleven STUN", never "you're on fourteen", so pressing a box opens a
dialog of every step from 50 off to 50 on and the app does the subtraction —
the arithmetic that goes wrong when it is done in someone's head in a hurry.
"Take" and "Recover" are separate blocks rather than one run through zero,
because a misread sign is a character knocked out by a heal, and the small
numbers come first in each because that is what dice produce. The old behaviour is still there
at the bottom of the dialog as "Or set it exactly", which is what a game master
setting a monster up actually wants.

Each box is coloured by how much of the total is left, so the state of a fight
reads off the panel before any of the numbers do. Where the boundaries fall is a
rule about characters rather than about colours, so it lives in `bandFor`
(`src/lib/hero.ts`) with the characteristics themselves, and the component is
left only mapping each band onto a daisyUI tone — `error`, `warning`, `success` —
which each theme then draws in its own red, yellow and green.

A Recovery is a button, but the arithmetic is not: `POST
/api/sessions/:id/stage/:slotId/recover` does it in one `UPDATE`, adding RECOVERY
to both current values and capping each at the character's total. Two screens are
looking at the same monster and one of them is always slightly behind, so a
button that computed the new number from what it happened to be showing would
lose one of two Recoveries pressed at once. Its neighbour, `…/rest`, is the same
shape and the blunter instrument: END and STUN set straight to the totals, BODY
untouched.

Those two and `PATCH /api/sessions/:id/stage/:slotId/vitals` are the routes both
roles may call, and all of them share one authorization helper —
`requireSlotAccess` — so there is one answer to who may change a slot
rather than four that could drift apart. The game master runs the fight and may write any slot; a player may write exactly
the slot holding the character they claimed, checked on the server rather than by
hiding the boxes. Both end in the same `publish`, so an edit from either screen
reaches every screen the usual way. `src/lib/hero.ts` names the seven
characteristics once, for the form fields, the labels and the API alike.

## The log is state, not a notice

Everything the table does is broadcast as a *snapshot*: the whole of what is true
now, rebuilt and republished on every change. There is one exception —
`broadcastSessionNotice`, which says something out loud once and keeps nothing.
That is right for a toast: a client reconnecting five minutes later should not be
told about the Post-Segment 12 Recovery it missed.

The log is deliberately on the other side of that line. It rides the snapshot,
because a history that only lived in the browsers watching at the time would not
be a history: a reload would empty it, and a player who joins an hour in would
see nothing of the hour. The first line makes the case on its own — a session is
started before any screen is watching it, so `Session started` can only ever be
read out of the database.

So `session_events` is a table, `sessionEvents.record` is how anything writes to
it, and `buildSnapshot` carries the tail of it to every screen. What the lines
actually *say* is `src/server/events.ts`, and it is a module of its own for two
reasons: the log has a voice, and a voice stays consistent only when it is in one
place to be read; and the events are written from three modules — the session
routes, the auth routes, and the socket's own grace-period removal — of which
`ws.ts` cannot import from `routes/sessions.ts` without closing a cycle.

The voice is one rule: past tense, and whoever acted is the subject. The clock is
the single line that breaks it — `Turn 2 Segment 3` names nobody, because what it
records is where the fight is rather than who pressed Next. The rule is that
the clock announces every segment it is *placed at*: `advanceTurn` writes one
where the walk lands, the session's own creating transaction writes `Turn 1
Segment 12`, and Restart writes it again on the way back. That is why stepping
from one character to the next inside a segment writes nothing — the marker moved
and the clock did not — and why the first press of `Next` in a fresh fight is
silent: the segment it opens was named when the session was made. What the rule
buys is that every line in the log sits under a segment the log has named. Nothing else was
needed: every mutating route already ends in `publish`, and `websocket.open`
already replays the current snapshot to a reconnecting client, so the log follows
both without a route or a socket message of its own.

The table is unbounded and the wire is not. `LOG_LIMIT` in `queries.ts` trims
each snapshot to the most recent two hundred lines — far more than the drawer can
show, and small enough that a fight running for hours is not sending hours of
history down the wire every time somebody presses a button.

On screen it is a drawer rather than a panel, opened from the `Log` control in
the upper left. It pushes the columns aside rather than covering them, because it
is the one overlay in the app you might want open *while* you work; every other
one — the sheet, the modals — is something you deal with and dismiss. Below
`lg:` there is no width to give up, so there it is a block above the page
instead.

## The turn chime

When the turn reaches a player's character, that player — and only that player —
gets a toast and a two-note chime. The chime is synthesised with the Web Audio
API (`src/client/ding.ts`) rather than shipped as a file, so there is no asset to
serve and nothing to add to the page's CSP.

Browsers refuse to start audio for a page nobody has interacted with. A player
has always clicked their way in by the time a turn can reach them, so it plays in
practice, but every step is best effort and the toast carries the message on its
own if audio is refused.

Announcing the turn is deliberately about *changes*: the snapshot that arrives on
a reconnect or a page load says nothing has changed, so a player who was already
up is not chimed at again. The alert is keyed on the turn and the segment as well
as the character, so a SPD 12 hero is announced for each of their twelve phases
rather than once for the whole turn.

## Character sheets

Sheets are uploaded HTML and keep their JavaScript, so a sheet with dice buttons
or auto-calculating fields keeps working. They are therefore treated as
untrusted code.

Nothing is rewritten or stripped on upload. The isolation happens on delivery:
each sheet is served with a `sandbox` Content-Security-Policy and embedded in an
iframe that repeats it as an attribute, deliberately *without*
`allow-same-origin`. That gives the document an opaque origin — its scripts run,
but it cannot read the app's cookies or storage, reach into the surrounding page,
or call the API as the signed-in user. A sheet that tries gets a `SecurityError`
for `document.cookie` and a CORS rejection from `origin: null` for any fetch;
both are asserted in `tests/e2e.test.ts`.

**A sheet is shown as it was written.** Whichever of the three places it is opened
from — the library preview, the session console, the player's `My sheet` — it goes
through one `SheetOverlay` (`components/SheetFrame.tsx`), and there is nothing of
ours around it: no title bar, no border, no rounding, no padding. A sheet is a
whole page of somebody else's design, and a strip of our own chrome would both take
the room and change the shape it is laid out in. The one thing over it is the close
control, in the *window's* top right rather than the sheet's, so it stays in the
same place whatever size the sheet is drawn at. It is an `IconButton`, the same
one a card's icons are, because that is already built to stay readable over
something we know nothing about — here either the dimmed page or the sheet itself.

Escape closes the sheet, and so does a click on the dimmed page around it. The
button is not a convenience on top of those two: a sandboxed cross-origin frame
takes the focus when a reader clicks into a sheet, and no keystroke reaches this
page again until they click back out, so Escape alone would strand them.

It is drawn in the window's own aspect ratio, so a sheet written for a 16:9 screen
gets one. `--sheet-size` is a single percentage and it sets *both* dimensions,
which is what makes the ratio come out right without any measuring: at the default
of 90 the sheet is nine tenths of the window's width and nine tenths of its height
— the same shape, smaller, with the dimmed page still showing around it — and at
100 it fills the viewport outright. The deployment picks the number with
`SHEET_WIDTH_PCT`, which reaches the browser through `/appearance.css` exactly as
the card size does.

Who may read a sheet:

| | Sheets they can open |
| --- | --- |
| Game master | every character in their own campaigns |
| Player | only the character they have claimed, through `My sheet` |
| Anyone else | none — the route returns 404, never 403 |

## Deployment

The app expects a TLS-terminating reverse proxy in front of it.

```bash
bun install --production
bun run cli db:migrate
NODE_ENV=production bun run start
```

Set `TRUSTED_PROXY=1` so `X-Forwarded-For` is honoured for rate limiting and
logs. Without it the forwarded header is ignored — otherwise anyone could spoof
it to escape a rate limit — and the socket address is used instead.

Two response headers cannot be set by the app, because Bun's bundler serves the
HTML document itself: **`Strict-Transport-Security` and `frame-ancestors`**. The
page carries a `<meta>` CSP covering everything else; set these at the proxy:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;   # required for live updates
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy   "frame-ancestors 'none'" always;

    client_max_body_size 12m;                    # a sheet and an image, 5 MB each
}
```

The `Upgrade` headers are not optional: without them the WebSocket cannot
connect and player screens stop updating live.

Back up `data/` — it holds both the database and every uploaded file.

## Security notes

- **Passwords** are argon2id (`Bun.password`). Sign-in failures return one
  message whatever the cause, and an unknown address still runs a verify, so
  neither the wording nor the timing reveals which addresses have accounts.
- **Session tokens** are 256 bits of CSPRNG output, stored only as a SHA-256
  hash, so a leaked database cannot be replayed as live sessions.
- **Session codes** are 60 bits (12 characters, ambiguous glyphs excluded so
  they can be read aloud). Joining is rate limited, and a code stops resolving
  the moment its session ends, so guessing one is not a practical attack.
- **SQL** is parameterised throughout; every statement lives in
  `src/db/queries.ts` and nothing interpolates into SQL.
- **CSRF**: cookies are `SameSite=Lax`, and mutating requests must additionally
  present a same-origin `Sec-Fetch-Site` or a matching `Origin`. There are no
  form posts.
- **Uploads** are checked by content, not by name — images by magic bytes, so an
  HTML payload named `.png` is rejected. Files are stored under generated names
  outside any served directory and reached only through authorised routes.
- **Errors** shown to a user never carry internal detail; anything unexpected is
  logged in full server-side and reported as one generic line.
- **Logs** are JSON lines with a request id, and redact passwords, tokens,
  cookies and session codes.

## Tests

```bash
bun test           # unit and HTTP integration
bun run test:e2e   # the above plus real-browser tests
bun run typecheck
```

The browser tests cover what only exists in a live page — the segment panel's
segment filter narrowing one reader's list without touching anyone else's, dragging
a character card onto another campaign, player screens updating without a refresh,
a sheet opening in the window's own shape, and the sheet sandbox holding. They need Playwright's
Chromium (`bunx playwright install chromium`) and are skipped without it.

In development you may see a console warning that an inline script was blocked
by the page CSP. That is Bun's hot-reload injection; the production build
contains no inline scripts.
