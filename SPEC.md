## TTRPG Syncronizer

You are a web development expert. You are designing a new web application. This
document explains the requirements that must be adhered to.

## Architecture & Design

* The app must be authored in JavaScript or something that transpiles to
  JavaScript. Prefer bun over node.

* Use SQLite for local storage.

* Use Tailwind for styling. Always offer light and dark mode for visual
  elements. Every page carries the light/dark/system control, so the choice can
  be made or changed wherever the reader happens to be.

* Make good use of the screen. On a wide, short screen — a 16:9 monitor — a page
  should fill one viewport with its panels side by side, each scrolling its own
  content, rather than stacking them into a page that scrolls as a whole. Narrow
  or tall screens keep the stacked layout. Where cards sit side by side with
  another panel, as the campaigns do, the panel holding them is no wider than the
  whole number of cards it can show — never part of a further column — and the
  panel beside it takes the room that leaves.

* How large a card's picture is drawn is a deployment setting, not a constant in
  the code. It measures the picture: the card comes out larger, since its border
  and the name underneath are extra.

* A character sheet is shown as it was written: it opens over the page in the
  window's own aspect ratio, with nothing drawn around it — no title, no border,
  no margin — save the control that closes it. How much of the window it takes is
  a deployment setting; by default it is most of it, leaving the page dimmed
  around the edges.

* A card in a library shows its picture as a square, with the name below it and
  its controls as icons over the lower right of the picture: edit and delete,
  and on a character card an icon that opens its sheet. The strip carrying the
  name takes the page's own background rather than the card's, so it reads as the
  ground the picture sits on.
  Cards must come out the same size as each other whatever the length of the name
  they carry, and in every library. They must show a clear highlight when
  hovered, and give the same feedback to anyone arriving by keyboard rather than
  mouse.

* A question asked before something irreversible is the app's own dialog, drawn
  like every other: `window.confirm` is never used, because the browser draws it
  in its own chrome and it ignores the theme and the palette entirely. The button
  that goes through with it names the action rather than saying "OK", so it still
  says what will happen when read on its own, and the question can be refused
  with Escape or the close control as well as with Cancel.
  The one native dialog left is `window.prompt`, as the fallback when the browser
  refuses clipboard access and the text has to be offered for copying by hand.

* Observe OWASP Top Ten guidelines.

* Observe best practices for modern web development.

* All error messages should be user-friendly.

* Implement consistent logging to aid debugging.

## Terms

We define the following terms.

### Game Master

A game master or GM is an administrative user. They authenticate with email and
password and have read/write access to make changes.

### Player

A player is a non-administrative user. Players authenticate with a session code
and are read-only.

### Character

A character is a fictional persona in the game. There are two types of
characters:

#### Player Character

A player character or PC is a persona played by a player.

#### Non-Player Character

A non-player character or NPC is a persona played by the game master.

### Session

A session is a single continuous sitting of a game that might last a few hours.

### Campaign

A campaign is a connected series of sessions that share a arcing story.

## Features

The app should have the following features:

* All pages must be inaccessible publicly. Game masters must authenticate with
  email and password, and players must authenticate with a session code.

* Create a CLI to add, edit, and delete game master accounts. There will be no
  UI for account management.

* A game master may create, edit, and delete campaigns. Each campaign must have
  a unique name. Each campaign may have a background image. Present the campaign
  library as cards.

* A game master may add, edit, and delete PCs and NPCs. These are represented by
  HTML file uploads. Each PC and NPC must be categorized into one campaign. Each
  PC and NPC may have a background image. Either file may be chosen with the file
  picker or dropped onto its field; a sheet may also be dropped anywhere on the
  character panel, which opens the add form holding it. The add and edit form
  asks for the sheet first, then the name, the type, the campaign, and the image. Uploading a sheet
  fills the name in from the file's name, minus its extension, unless the game
  master has typed a name of their own. Pictures — a campaign's, a character's,
  and one found inside a sheet alike — are scaled down on the way in to the size
  the cards show them at, in proportion and without cropping. An uploaded sheet
  is also scanned for a portrait: if it carries one, and the character has no picture of its own, that
  becomes the character's image. A picture the game master chose is never
  replaced by one found in a file. Present the character library as cards,
  ordered by name whatever their kind.
  A character may be refiled into another campaign by dragging its card onto that
  campaign's card. A character playing in a session that is still running may not
  be moved until that session ends, and may not be deleted at all: deleting would
  take them off the stage mid-fight with the players watching them vanish. Taking
  them off the stage is enough to free them, since the rule is about being in play
  rather than about the campaign being busy — an ended session holds nothing back.

* A game master may start a new session on a campaign that has none running.
  Every PC in the campaign joins the new session automatically, in name order; the NPCs stay in the library until the
  scene calls for them. This generates a unique unguessable code. Provide a means to copy the code (and the URL target that receives the
  code) to the clipboard so that the GM can easily send session invites to
  players. Once the players receive the code, they may use it to authenticate
  and join the session.

* The game master may indicate which characters from the library are active in
  the current session. These characters will be visible to the players that
  join.

* A game master may end a running session. Once the session is ended, the code
  should no longer work. It can be ended from its own console or straight from the
  library's list of sessions in progress, without opening the console first. Either
  way it asks before doing it, and the library's question names the campaign, since
  more than one session may be listed.

* The game master's library lists the sessions in progress in campaign name
  order, each with the round it has reached and how many players have joined.
  Both update live as players join or leave, without the game master reloading
  the page. The list itself is live too: a session started or ended elsewhere —
  another tab, another device — appears or disappears on its own.

* Multiple sessions should be able to be active at the same time, but only one
  per campaign. Starting a second session on a campaign that is already playing
  must be refused; the game master ends the first one to start another.

* When a player joins a session, they should be prompted for their name. Ensure
  that names are unique in a session. They should also be presented with a list
  of the active PCs that the GM has placed in this session, in name order, as
  cards of the same size and shape as the library's. From this list, they may choose one PC to
  play. This PC to player association must be maintained as
  long as the player stays in the session.

* A player who closes their browser leaves the session: their seat is given up
  and their PC becomes free for someone else to claim. A brief disconnection —
  a reload, a flaky connection, a phone locking itself — must not count as
  leaving, so this only takes effect after a grace period.

* An active PC that no player has claimed should be highlighted in an alert
  colour on the session page, so that both the game master and the players can
  see at a glance which characters are still free. The cue must not rely on
  colour alone.

* A player's session page should be headed by their own name, with the
  character they are playing named underneath it.

* Once a session is joined, players should see four panels: the round, their own
  character, a list of all the joined players, and a list of all active PCs and
  NPCs. For the PCs, that last list should include which player is associated.
  No row in it offers to open a sheet; a player reaches their own through a
  single `My sheet` control on their `My character` panel, and no other sheet is
  theirs to open.

* No panel on a player's session page is stretched to fill the screen: each is
  only as tall as what it holds. Where the screen is wide enough for two columns,
  the round, the player's own character and the list of players sit in the first
  column — so the round is the width of the player list rather than of the page —
  and the scene sits in the second. Stacked, the order is the round, their
  character, the scene, then the players.

* Every character, PC and NPC alike, is a HERO System 5th Edition Revised
  character. Each one in the library carries six characteristics — SPEED,
  DEXTERITY, RECOVERY, ENDURANCE, STUN and BODY — edited in the character
  editor. A character nobody has filled in yet reads as zeros.

* ENDURANCE, STUN and BODY are also tracked per active character in a session,
  as what that copy has left rather than what it started with: two copies of one
  NPC take their own wounds. A slot is seeded from the character's totals when
  it joins the scene and is independent from then on, so editing the library
  mid-session never quietly heals anyone. The values are shown as what is left
  over the total, may go negative, and are not capped at the total.

* The game master may see and edit those three for any active character, from
  the initiative panel. A player may see and edit them for their own character
  only, on their `My character` panel. The scene shows them to a player for
  nobody at all — not for anyone else, since how hurt the monster is is the game
  master's to give out, and not for themselves either, since their own panel
  already carries them. Every change reaches all the screens live.

* Each PC and NPC on a session page should be shown with a small picture of
  itself — in the scene, and in the list the game master adds them from —
  falling back to a placeholder for a character that has no background image.

* The list of PCs and NPCs should be presented in initiative order. For now this
  will be controlled manually. Allow the GM to drag PCs and NPCs to change the
  order.

* The GM should be able to add and remove NPCs from the session. When this
  happens, the player's screens should update instantly without a refresh. Use
  websockets or SSE for this. Where the session console has room for three
  columns, the library the GM adds from sits next to the initiative order it
  feeds, with the players in the last column.

* The GM should be able to indicate what PC or NPC is currently active, i.e.,
  whose turn it is. When the GM makes this selection, the player screens should
  instantly update without a refresh.

* An NPC may be on the stage more than once. Adding it again brings on another
  copy with its own place in the initiative order and its own turn, and its card
  stays in the library panel so it can be added again. Where a character has more
  than one copy on the stage, each is numbered beside its name, and the library
  card shows how many of it are out. A copy keeps its number for the whole fight:
  removing one or dragging the order about never renumbers the rest, and the next
  copy added takes the next number up rather than filling a gap. Player characters
  are unchanged — one each, and their card leaves the library once they are on.

* The GM should be able to restart the turn order, taking the session back to
  round one with no turn set, as though the fight had not begun. The characters
  on the stage, their initiative order and the players' claims are all left
  alone: this restarts the fight, not the session. Since it throws away however
  many rounds have been tracked, it asks before doing it.

* When the turn reaches a player's character, that player should get a toast and
  an audible chime. Only that player: the turn passing to anyone else must stay
  silent.

## Conclusion

Ask me about design decisions or for any additional details you may need.
