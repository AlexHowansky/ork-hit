# TTRPG Synchronizer

A private table companion. The game master keeps a library of campaigns and
character sheets, starts a session, and hands out a code. Players join with that
code, claim a character, and watch the table update live — who is in the scene,
what order they act in, whose turn it is, and which characters nobody has
claimed yet.

Built on Bun 1.4, SQLite, React 19 and Tailwind v4. One process, one database
file, no external services.

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
opens that session's socket, so the round and the player count follow the table
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
mutation recomputes a complete snapshot — session, players, characters in
initiative order — and publishes it to everyone watching. The lists are a dozen
rows at most, and it means a client can never merge updates in the wrong order:
a reorder racing a turn change cannot leave someone highlighting the wrong row.

**One live session per campaign.** Two would give the same characters two
initiative orders and two turn markers, and a code would not say which table a
player had joined. The rule is a partial unique index on `game_sessions`
(`002_one_active_session_per_campaign.sql`) covering active rows only, so a
campaign can still be played again and again; the start handler checks first and
answers 409 with something a game master can act on, and the index is what makes
that check impossible to get around.

**A session opens with the party in it.** Starting one inserts every PC in the
campaign into the initiative order in a single statement, inside the same
transaction that creates the session — `sessionCharacters.addCampaignPcs` in
`src/db/queries.ts`. Characters already in the session are filtered out of that
statement rather than left to `ON CONFLICT DO NOTHING`, because a skipped row
would leave a hole in the positions.

**Initiative positions are dense.** `session_characters.position` is always
`0..n-1`. Adds append, removes close the gap, and a reorder sends the entire
ordered list rather than a move — which makes it idempotent and lets the server
reject a list built from a stale view instead of silently dropping a character.

**Card styling is shared.** The campaign and character grids are different
components, so their shape and hover treatment live in one place — `CARD_BASE`
in `src/client/components/ui.tsx` — and the player's character picker is built
from the same two, so a player sees the shape the game master saw. The picture is
the square, not the card: the
image well is a full-width square, the card's controls ride on the picture as
icons in its lower right corner (`CardActions` and `IconButton`) — edit, delete,
and on a character card one that opens its sheet — and the name sits under it on
its own. That keeps the card mostly picture, and since every caption is built
the same way a row still lines up whatever the names are. An icon button always
carries a label — it is the tooltip and the only thing a screen reader has to go
on. Every hover rule is paired with a `focus-within` one,
because a card is a box of buttons and a keyboard user would otherwise get no
feedback at all.

**So is the grid the cards sit in.** `CARD_GRID`, alongside it, lays them out on
a fixed-width track rather than a fraction of the panel. The two libraries sit in
panels of different widths, and anything proportional makes a campaign card and a
character card come out different sizes; a fixed track makes them identical at
every window size, at the price of some slack at the end of a row.

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

**Wide screens get a dashboard, not a document.** A 16:9 monitor is much shorter
relative to its width than a phone, so a page that stacks its panels makes the
game master scroll away from the turn tracker mid-turn. A `wide` variant in
`src/client/styles.css` — keyed on the aspect ratio as well as the width, so a
portrait monitor is left alone — switches the session and library pages to a
frame exactly one viewport high, panels side by side, each scrolling its own
list. `AppPage` and `Panel`'s `scroll` prop in `src/client/components/ui.tsx`
carry this; the routes only choose how the panels divide the frame, and — on the
session console, with `order` rather than a second copy of the markup — what
sequence they sit in once there are three columns. Anything narrower or taller
keeps the stacked layout unchanged.

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
up is not chimed at again. The alert is keyed on the round as well as the
character, so a scene with one character in it still announces each new lap.

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
- **Session codes** are 120 bits (24 characters, ambiguous glyphs excluded so
  they can be read aloud). Joining is rate limited, and a code stops resolving
  the moment its session ends.
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

The browser tests cover what only exists in a live page — dragging the
initiative order with a mouse and with the keyboard, player screens updating
without a refresh, and the sheet sandbox holding. They need Playwright's
Chromium (`bunx playwright install chromium`) and are skipped without it.

In development you may see a console warning that an inline script was blocked
by the page CSP. That is Bun's hot-reload injection; the production build
contains no inline scripts.
