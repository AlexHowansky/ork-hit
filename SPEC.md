## TTRPG Syncronizer

You are a web development expert. You are designing a new web application. This
document explains the requirements that must be adhered to.

## Architecture & Design

* The app must be authored in JavaScript or something that transpiles to
  JavaScript. Prefer bun over node.

* Use SQLite for local storage.

* Use Tailwind for styling. Always offer light and dark mode for visual
  elements.

* Make good use of the screen. On a wide, short screen — a 16:9 monitor — a page
  should fill one viewport with its panels side by side, each scrolling its own
  content, rather than stacking them into a page that scrolls as a whole. Narrow
  or tall screens keep the stacked layout.

* A card in a library shows its picture as a square, with the name below it and
  its controls as icons over the lower right of the picture: edit and delete,
  and on a character card an icon that opens its sheet.
  Cards must come out the same size as each other whatever the length of the name
  they carry, and in every library. They must show a clear highlight when
  hovered, and give the same feedback to anyone arriving by keyboard rather than
  mouse.

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
  PC and NPC may have a background image. Present the character library as
  cards, ordered by name whatever their kind.

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
  should no longer work.

* The game master's library lists the sessions in progress, each with the round
  it has reached and how many players have joined. Both update live as players
  join or leave, without the game master reloading the page.

* Multiple sessions should be able to be active at the same time, but only one
  per campaign. Starting a second session on a campaign that is already playing
  must be refused; the game master ends the first one to start another.

* When a player joins a session, they should be prompted for their name. Ensure
  that names are unique in a session. They should also be presented with a list
  of the active PCs that the GM has placed in this session, in name order, as
  cards of the same size and shape as the library's. From this list, they may choose one PC to
  play. This PC to player association must be maintained as
  long as the session lasts.

* An active PC that no player has claimed should be highlighted in an alert
  colour on the session page, so that both the game master and the players can
  see at a glance which characters are still free. The cue must not rely on
  colour alone.

* A player's session page should be headed by their own name, with the
  character they are playing named underneath it.

* Once a session is joined, players should see two panels. One should contain a
  list of all the joined players, and one should contain a list of all active
  PCs and NPCs. For the PCs, the list should include which player is associated.

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

* When the turn reaches a player's character, that player should get a toast and
  an audible chime. Only that player: the turn passing to anyone else must stay
  silent.

## Conclusion

Ask me about design decisions or for any additional details you may need.
