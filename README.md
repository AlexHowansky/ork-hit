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

Two things are worth knowing before reading the code.

**Every change republishes the whole session.** Rather than sending diffs, any
mutation recomputes a complete snapshot — session, players, characters in
initiative order — and publishes it to everyone watching. The lists are a dozen
rows at most, and it means a client can never merge updates in the wrong order:
a reorder racing a turn change cannot leave someone highlighting the wrong row.

**Initiative positions are dense.** `session_characters.position` is always
`0..n-1`. Adds append, removes close the gap, and a reorder sends the entire
ordered list rather than a move — which makes it idempotent and lets the server
reject a list built from a stale view instead of silently dropping a character.

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
| Player | only the character they have claimed |
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

    client_max_body_size 8m;                     # sheets are 2 MB, images 5 MB
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
