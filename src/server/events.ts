/**
 * Every line the log can carry.
 *
 * One module rather than a string at each call site, for two reasons.
 *
 * The first is that the log has a voice, and a voice is only consistent if it is
 * in one place to be read. These are the sentences a table will scroll back
 * through at midnight trying to work out when somebody went; they should sound
 * like they were written together, because they were.
 *
 * The second is circular imports. The events are written from three modules —
 * the session routes, the auth routes, and the socket's own grace-period
 * removal — and `ws.ts` cannot import from `routes/sessions.ts`, which already
 * imports from `ws.ts`. Somewhere neutral is the only place all three can reach.
 *
 * Builders rather than templates at the call site, so a test asserts on the same
 * string the server writes rather than on a copy of it that can drift.
 *
 * Two rules hold the wording together. Every line is in the past tense and names
 * the person, because a log line is read long after the moment it describes:
 * `Ada joined` still makes sense an hour later, where "joined" on its own does
 * not. And **whoever acted is the subject of the sentence** — the players' own
 * doings in their names, the game master's in theirs — so that reading back
 * through a night tells you not only what the table came to be, but who made it
 * so. The routes can always tell: a player's claim and the game master's
 * assignment are separate endpoints behind separate authorisations.
 *
 * The clock is the one exception, and it is at the bottom with its reasons.
 */

export const SESSION_STARTED = "Session started";

/* ------------------------------------------------------------ the players' */

export const playerJoined = (name: string): string => `${name} joined`;

export const playerSelected = (name: string, character: string): string =>
  `${name} selected ${character}`;

export const playerLeft = (name: string): string => `${name} left`;

/**
 * Nobody pressed anything for this one — a browser closed and the grace period
 * ran out — which is exactly why it is worth writing down. It is the only way of
 * leaving the table that no one at the table saw happen.
 */
export const playerDisconnected = (name: string): string => `${name} was disconnected`;

/* ------------------------------------------------------ the game master's */

export const gmAssigned = (character: string, name: string): string =>
  `The game master assigned ${character} to ${name}`;

export const gmUnassigned = (character: string, name: string): string =>
  `The game master unassigned ${character} from ${name}`;

/**
 * One line rather than an unassignment and an assignment, because it was one
 * action by one person. Two would also read as a moment when the character was
 * held by nobody, which never happened.
 */
export const gmReassigned = (character: string, from: string, to: string): string =>
  `The game master reassigned ${character} from ${from} to ${to}`;

export const gmKicked = (name: string): string => `The game master kicked ${name}`;

export const gmAddedToScene = (character: string): string =>
  `The game master added ${character} to the scene`;

export const gmRemovedFromScene = (character: string): string =>
  `The game master removed ${character} from the scene`;

/* ------------------------------------------------------------- the clock's */

/**
 * The one line with nobody in it.
 *
 * Every other event here names whoever acted, because somebody did. A segment
 * beginning is the fight's own clock moving, and while a game master pressed
 * Next to get there, what the line records is where the fight now is rather than
 * who pressed what — so it is written the way a marker on a table is written,
 * flat and without a verb. It is also the line that gives all the others their
 * place: read back through a night, the events between two of these are what
 * happened in that segment.
 */
export const segmentBegan = (turn: number, segment: number): string =>
  `Turn ${turn} Segment ${segment}`;
