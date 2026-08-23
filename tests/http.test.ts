/**
 * End-to-end checks against a real server.
 *
 * These cover the boundaries that matter most: nothing is reachable without
 * signing in, one game master cannot see another's material, a player can only
 * open the sheet of the character they are actually playing, and a cross-site
 * request cannot change anything.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serverOptions } from "../src/server/app.ts";
import { registerServer } from "../src/server/ws.ts";
import { gms } from "../src/db/queries.ts";
import { unique } from "./helpers.ts";

let base: string;
let server: ReturnType<typeof Bun.serve>;

const ORIGIN_HEADER = () => ({ Origin: base });

beforeAll(async () => {
  server = Bun.serve({ ...serverOptions, port: 0 });
  registerServer(server as never);
  base = server.url.origin.replace(/\/$/, "");
});

afterAll(() => server.stop(true));

/** A signed-in game master, represented by the cookie their browser would hold. */
async function signIn(): Promise<{ cookie: string; email: string }> {
  const email = `${unique("gm")}@example.com`;
  const password = "a-sufficiently-long-password";
  gms.create(email, await Bun.password.hash(password, { algorithm: "argon2id" }));

  const response = await fetch(`${base}/api/auth/gm/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);

  const cookie = response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  return { cookie, email };
}

function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { Cookie: cookie, Origin: base, ...(init.headers ?? {}) } };
}

/** Creates a campaign with one PC and one NPC, and starts a session with both. */
async function makeTable(cookie: string) {
  const campaignForm = new FormData();
  campaignForm.set("name", unique("Campaign"));
  const campaign = await (
    await fetch(`${base}/api/campaigns`, authed(cookie, { method: "POST", body: campaignForm }))
  ).json();

  const addCharacter = async (kind: "pc" | "npc") => {
    const form = new FormData();
    form.set("campaignId", campaign.campaign.id);
    form.set("kind", kind);
    form.set("name", unique(kind));
    form.set("sheet", new File(["<h1>sheet</h1>"], "sheet.html"));
    const response = await fetch(
      `${base}/api/characters`,
      authed(cookie, { method: "POST", body: form }),
    );
    return (await response.json()).character;
  };

  const pc = await addCharacter("pc");
  const npc = await addCharacter("npc");

  const session = (
    await (
      await fetch(
        `${base}/api/sessions`,
        authed(cookie, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: campaign.campaign.id }),
        }),
      )
    ).json()
  ).session;

  for (const character of [pc, npc]) {
    await fetch(
      `${base}/api/sessions/${session.id}/characters/${character.id}`,
      authed(cookie, { method: "POST" }),
    );
  }

  return { campaign: campaign.campaign, pc, npc, session };
}

/** Joins a session as a player and returns their cookie. */
async function joinAs(code: string, name: string): Promise<string> {
  const response = await fetch(`${base}/api/sessions/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ code, name }),
  });
  expect(response.status).toBe(201);
  return response.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
}

/* -------------------------------------------------------------------------- */

describe("nothing is reachable without signing in", () => {
  const guarded = [
    "/api/campaigns",
    "/api/characters",
    "/api/sessions",
  ];

  test.each(guarded)("%s refuses an anonymous caller", async (path) => {
    const response = await fetch(base + path);
    expect(response.status).toBe(401);
  });

  test("an anonymous caller cannot reach a sheet or an image", async () => {
    const { cookie } = await signIn();
    const { pc } = await makeTable(cookie);

    expect((await fetch(`${base}/sheets/${pc.id}`)).status).toBe(404);
    expect((await fetch(`${base}/uploads/images/anything`)).status).toBe(401);
  });

  test("an unknown path is a 404, not the application", async () => {
    expect((await fetch(`${base}/not-a-page`)).status).toBe(404);
  });
});

describe("one game master cannot see another's material", () => {
  test("a campaign, its characters and its sessions are all invisible", async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { campaign, pc, session } = await makeTable(owner.cookie);

    const campaigns = await (
      await fetch(`${base}/api/campaigns`, authed(stranger.cookie))
    ).json();
    expect(campaigns.campaigns.find((entry: { id: string }) => entry.id === campaign.id))
      .toBeUndefined();

    // Probing by id reveals nothing either.
    expect(
      (await fetch(`${base}/api/sessions/${session.id}`, authed(stranger.cookie))).status,
    ).toBe(404);
    expect((await fetch(`${base}/sheets/${pc.id}`, authed(stranger.cookie))).status).toBe(404);
    expect(
      (await fetch(
        `${base}/api/campaigns/${campaign.id}`,
        authed(stranger.cookie, { method: "DELETE" }),
      )).status,
    ).toBe(404);
  });
});

describe("character sheets reach only the right people", () => {
  test("a player opens their own sheet and nobody else's", async () => {
    const gm = await signIn();
    const { pc, npc, session } = await makeTable(gm.cookie);

    // A second player character, so there is someone else's sheet to try.
    const form = new FormData();
    form.set("campaignId", pc.campaignId);
    form.set("kind", "pc");
    form.set("name", unique("pc"));
    form.set("sheet", new File(["<h1>other</h1>"], "sheet.html"));
    const other = (
      await (await fetch(`${base}/api/characters`, authed(gm.cookie, { method: "POST", body: form }))).json()
    ).character;
    await fetch(
      `${base}/api/sessions/${session.id}/characters/${other.id}`,
      authed(gm.cookie, { method: "POST" }),
    );

    const alice = await joinAs(session.code, "Alice");
    await fetch(
      `${base}/api/sessions/${session.id}/claim`,
      authed(alice, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: pc.id }),
      }),
    );

    // Her own character: allowed.
    expect((await fetch(`${base}/sheets/${pc.id}`, { headers: { Cookie: alice } })).status).toBe(200);
    // Another player's character, and an NPC: both hidden.
    expect((await fetch(`${base}/sheets/${other.id}`, { headers: { Cookie: alice } })).status).toBe(404);
    expect((await fetch(`${base}/sheets/${npc.id}`, { headers: { Cookie: alice } })).status).toBe(404);
    // The game master sees everything in their own campaign.
    expect((await fetch(`${base}/sheets/${npc.id}`, { headers: { Cookie: gm.cookie } })).status).toBe(200);
  });

  test("a sheet is served into an opaque origin", async () => {
    const gm = await signIn();
    const { pc } = await makeTable(gm.cookie);

    const response = await fetch(`${base}/sheets/${pc.id}`, { headers: { Cookie: gm.cookie } });
    const policy = response.headers.get("content-security-policy") ?? "";

    // `sandbox` without `allow-same-origin` is what denies the sheet access to
    // this app's cookies, storage and DOM.
    expect(policy).toContain("sandbox");
    expect(policy).not.toContain("allow-same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

describe("players are read-only", () => {
  test("a player cannot reorder, set the turn, or touch the library", async () => {
    const gm = await signIn();
    const { pc, session } = await makeTable(gm.cookie);
    const player = await joinAs(session.code, "Bob");

    const attempts = [
      fetch(
        `${base}/api/sessions/${session.id}/order`,
        authed(player, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: [pc.id] }),
        }),
      ),
      fetch(
        `${base}/api/sessions/${session.id}/turn`,
        authed(player, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: pc.id }),
        }),
      ),
      fetch(`${base}/api/sessions/${session.id}/end`, authed(player, { method: "POST" })),
      fetch(`${base}/api/campaigns`, authed(player)),
      fetch(`${base}/api/characters/${pc.id}`, authed(player, { method: "DELETE" })),
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBeGreaterThanOrEqual(401);
      expect(response.status).toBeLessThan(500);
    }
  });

  test("a player cannot read a session they did not join", async () => {
    const gm = await signIn();
    const first = await makeTable(gm.cookie);
    const second = await makeTable(gm.cookie);
    const player = await joinAs(first.session.code, "Carol");

    expect(
      (await fetch(`${base}/api/sessions/${second.session.id}`, { headers: { Cookie: player } }))
        .status,
    ).toBe(401);
  });
});

describe("cross-site requests are refused", () => {
  test("a mutating request from another origin is blocked", async () => {
    const { cookie } = await signIn();
    const form = new FormData();
    form.set("name", unique("Campaign"));

    const response = await fetch(`${base}/api/campaigns`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example.com" },
      body: form,
    });

    expect(response.status).toBe(403);
  });

  test("a browser's own cross-site marker is enough to block it", async () => {
    const { cookie } = await signIn();
    const response = await fetch(`${base}/api/campaigns`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base, "Sec-Fetch-Site": "cross-site" },
      body: new FormData(),
    });

    expect(response.status).toBe(403);
  });

  test("reading is unaffected", async () => {
    const { cookie } = await signIn();
    const response = await fetch(`${base}/api/campaigns`, {
      headers: { Cookie: cookie, Origin: "https://evil.example.com" },
    });
    // A cross-origin read cannot see the response body anyway, and blocking it
    // would break nothing an attacker cares about.
    expect(response.status).toBe(200);
  });
});

describe("session cookies", () => {
  test("are http-only and same-site", async () => {
    const email = `${unique("gm")}@example.com`;
    const password = "a-sufficiently-long-password";
    gms.create(email, await Bun.password.hash(password, { algorithm: "argon2id" }));

    const response = await fetch(`${base}/api/auth/gm/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password }),
    });

    const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith("gm_sid="))!;
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie.toLowerCase()).toContain("path=/");
  });

  test("sign-in failures say the same thing whatever the cause", async () => {
    const email = `${unique("gm")}@example.com`;
    gms.create(email, await Bun.password.hash("the-real-password", { algorithm: "argon2id" }));

    const wrongPassword = await (
      await fetch(`${base}/api/auth/gm/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({ email, password: "not-the-password" }),
      })
    ).json();

    const unknownEmail = await (
      await fetch(`${base}/api/auth/gm/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
      })
    ).json();

    // Identical messages: whether an address has an account is not disclosed.
    expect(wrongPassword.error.message).toBe(unknownEmail.error.message);
  });
});

describe("a player leaving", () => {
  test("frees their name and their character so they can come back", async () => {
    const gm = await signIn();
    const { pc, session } = await makeTable(gm.cookie);

    const first = await joinAs(session.code, "Frank");
    await fetch(
      `${base}/api/sessions/${session.id}/claim`,
      authed(first, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: pc.id }),
      }),
    );

    await fetch(`${base}/api/auth/player/leave`, authed(first, { method: "POST" }));

    // The same name works again, and the character they held is free.
    const second = await joinAs(session.code, "Frank");
    const claim = await fetch(
      `${base}/api/sessions/${session.id}/claim`,
      authed(second, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: pc.id }),
      }),
    );
    expect(claim.status).toBe(200);
  });

  test("a refresh keeps the same identity and character", async () => {
    const gm = await signIn();
    const { pc, session } = await makeTable(gm.cookie);
    const player = await joinAs(session.code, "Grace");

    await fetch(
      `${base}/api/sessions/${session.id}/claim`,
      authed(player, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: pc.id }),
      }),
    );

    // A reload is just another request carrying the same cookie.
    const me = await (
      await fetch(`${base}/api/auth/me`, { headers: { Cookie: player } })
    ).json();

    expect(me.kind).toBe("player");
    expect(me.player.name).toBe("Grace");
    expect(me.player.claimedCharacterId).toBe(pc.id);
  });
});

describe("the session list counts the players in each", () => {
  const listSessions = async (cookie: string) =>
    (await (await fetch(`${base}/api/sessions`, authed(cookie))).json()).sessions;

  test("a new session starts at nobody, and the count follows who joins and leaves", async () => {
    const { cookie } = await signIn();
    const { session } = await makeTable(cookie);

    const found = async () =>
      (await listSessions(cookie)).find((entry: { id: string }) => entry.id === session.id);

    expect((await found()).playerCount).toBe(0);

    await joinAs(session.code, "Alice");
    const bob = await joinAs(session.code, "Bob");
    expect((await found()).playerCount).toBe(2);

    await fetch(`${base}/api/auth/player/leave`, authed(bob, { method: "POST" }));
    expect((await found()).playerCount).toBe(1);
  });

  test("each session is counted separately", async () => {
    const { cookie } = await signIn();
    const first = await makeTable(cookie);
    const second = await makeTable(cookie);

    await joinAs(first.session.code, "Alice");

    const byId = new Map(
      (await listSessions(cookie)).map((entry: { id: string; playerCount: number }) => [
        entry.id,
        entry.playerCount,
      ]),
    );
    expect(byId.get(first.session.id)).toBe(1);
    expect(byId.get(second.session.id)).toBe(0);
  });
});

describe("a campaign runs one session at a time", () => {
  const start = (cookie: string, campaignId: string) =>
    fetch(
      `${base}/api/sessions`,
      authed(cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      }),
    );

  test("starting a second one is refused, and says why", async () => {
    const { cookie } = await signIn();
    const { campaign } = await makeTable(cookie);

    const response = await start(cookie, campaign.id);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toMatch(/already has a session running/i);
  });

  test("ending the first lets the next one start", async () => {
    const { cookie } = await signIn();
    const { campaign, session } = await makeTable(cookie);

    await fetch(`${base}/api/sessions/${session.id}/end`, authed(cookie, { method: "POST" }));

    const response = await start(cookie, campaign.id);
    expect(response.status).toBe(201);
    expect((await response.json()).session.id).not.toBe(session.id);
  });
});

describe("ending a session", () => {
  test("freezes it against every further change", async () => {
    const gm = await signIn();
    const { pc, session } = await makeTable(gm.cookie);
    await fetch(`${base}/api/sessions/${session.id}/end`, authed(gm.cookie, { method: "POST" }));

    // The owner is still the owner, but an ended session accepts nothing.
    const mutations = await Promise.all([
      fetch(
        `${base}/api/sessions/${session.id}/characters/${pc.id}`,
        authed(gm.cookie, { method: "DELETE" }),
      ),
      fetch(
        `${base}/api/sessions/${session.id}/order`,
        authed(gm.cookie, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: [pc.id] }),
        }),
      ),
      fetch(
        `${base}/api/sessions/${session.id}/turn/advance`,
        authed(gm.cookie, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction: "next" }),
        }),
      ),
    ]);

    for (const response of mutations) expect(response.status).toBe(409);

    // Reading it back still works, so the session stays visible as history.
    expect(
      (await fetch(`${base}/api/sessions/${session.id}`, authed(gm.cookie))).status,
    ).toBe(200);
  });

  test("revokes the code and cuts the player off", async () => {
    const gm = await signIn();
    const { session } = await makeTable(gm.cookie);
    const player = await joinAs(session.code, "Dave");

    await fetch(`${base}/api/sessions/${session.id}/end`, authed(gm.cookie, { method: "POST" }));

    const rejoin = await fetch(`${base}/api/sessions/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ code: session.code, name: "Eve" }),
    });
    expect(rejoin.status).toBe(404);

    // The player's cookie no longer identifies anyone.
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: player } })).json();
    expect(me.kind).toBe("anonymous");
  });
});

describe("the library socket", () => {
  interface SessionList {
    type: string;
    sessions: { id: string; status: string; campaignName: string }[];
  }

  const wsBase = () => base.replace(/^http/, "ws");

  /**
   * Bun's WebSocket client accepts request headers, which is how a socket is
   * given the cookie a browser would have sent. The DOM type in `lib` has no
   * such argument, hence the cast.
   */
  function connect(cookie: string): WebSocket {
    return new WebSocket(`${wsBase()}/ws?scope=library`, {
      headers: { Cookie: cookie, Origin: base },
    } as unknown as string[]);
  }

  /** The next message the socket delivers, parsed. */
  function nextMessage(socket: WebSocket): Promise<SessionList> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the socket sent nothing")), 5000);
      socket.addEventListener(
        "message",
        (event) => {
          clearTimeout(timer);
          resolve(JSON.parse(String((event as MessageEvent).data)));
        },
        { once: true },
      );
    });
  }

  test("sends the session list on open, and again whenever it changes", async () => {
    const { cookie } = await signIn();
    const { campaign, session } = await makeTable(cookie);

    const socket = connect(cookie);

    try {
      const onOpen = await nextMessage(socket);
      expect(onOpen.type).toBe("sessions");
      expect(onOpen.sessions.map((entry) => entry.id)).toContain(session.id);

      // Ending it republishes the list, which is what takes the row off a
      // library open in another tab.
      const afterEnd = nextMessage(socket);
      await fetch(`${base}/api/sessions/${session.id}/end`, authed(cookie, { method: "POST" }));
      expect(
        (await afterEnd).sessions.find((entry) => entry.id === session.id)?.status,
      ).toBe("ended");

      // So does renaming the campaign a session is listed under.
      const afterRename = nextMessage(socket);
      const form = new FormData();
      form.set("name", unique("Renamed"));
      await fetch(
        `${base}/api/campaigns/${campaign.id}`,
        authed(cookie, { method: "PATCH", body: form }),
      );
      expect(
        (await afterRename).sessions.find((entry) => entry.id === session.id)?.campaignName,
      ).toMatch(/^Renamed-/);
    } finally {
      socket.close();
    }
  });

  test("carries one game master's sessions and nobody else's", async () => {
    const mine = await signIn();
    const theirs = await signIn();
    const { session } = await makeTable(theirs.cookie);

    const socket = connect(mine.cookie);
    try {
      const list = await nextMessage(socket);
      expect(list.sessions.map((entry) => entry.id)).not.toContain(session.id);
    } finally {
      socket.close();
    }
  });

  test("refuses a caller who is not signed in", async () => {
    const socket = new WebSocket(`${wsBase()}/ws?scope=library`);
    const settled = new Promise<string>((resolve) => {
      socket.addEventListener("open", () => resolve("open"), { once: true });
      socket.addEventListener("close", () => resolve("closed"), { once: true });
      socket.addEventListener("error", () => resolve("closed"), { once: true });
    });
    expect(await settled).toBe("closed");
    socket.close();
  });
});

describe("a player who disconnects gives up their seat", () => {
  const GRACE_MS = Number(process.env.PLAYER_GRACE_MS);

  /** A player's socket, carrying the cookie their browser would have sent. */
  function watch(cookie: string, sessionId: string): Promise<WebSocket> {
    const socket = new WebSocket(
      `${base.replace(/^http/, "ws")}/ws?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: { Cookie: cookie, Origin: base } } as unknown as string[],
    );
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve(socket), { once: true });
      socket.addEventListener("error", () => reject(new Error("the socket was refused")), {
        once: true,
      });
    });
  }

  const roster = async (cookie: string, sessionId: string): Promise<string[]> => {
    const body = await (await fetch(`${base}/api/sessions/${sessionId}`, authed(cookie))).json();
    return body.snapshot.players.map((player: { name: string }) => player.name);
  };

  test("closing the last connection removes them, once the grace period is up", async () => {
    const { cookie } = await signIn();
    const { session } = await makeTable(cookie);
    const alice = await joinAs(session.code, "Alice");
    await joinAs(session.code, "Bob");

    const socket = await watch(alice, session.id);
    socket.close();

    // Still seated while the clock runs — closing a socket is not leaving.
    expect(await roster(cookie, session.id)).toContain("Alice");

    await Bun.sleep(GRACE_MS * 3);
    expect(await roster(cookie, session.id)).toEqual(["Bob"]);
  });

  test("coming straight back keeps the seat", async () => {
    const { cookie } = await signIn();
    const { session } = await makeTable(cookie);
    const alice = await joinAs(session.code, "Alice");

    // What a reload looks like from here: the socket goes, another arrives.
    const first = await watch(alice, session.id);
    first.close();
    const second = await watch(alice, session.id);

    await Bun.sleep(GRACE_MS * 3);
    expect(await roster(cookie, session.id)).toEqual(["Alice"]);
    second.close();
  });

  test("a second connection of the same player is not one player leaving", async () => {
    const { cookie } = await signIn();
    const { session } = await makeTable(cookie);
    const alice = await joinAs(session.code, "Alice");

    // Two tabs open on the same session; shutting one is not going away.
    const phone = await watch(alice, session.id);
    const laptop = await watch(alice, session.id);
    phone.close();

    await Bun.sleep(GRACE_MS * 3);
    expect(await roster(cookie, session.id)).toEqual(["Alice"]);
    laptop.close();
  });

  test("an ended session keeps the roster it finished with", async () => {
    const { cookie } = await signIn();
    const { session } = await makeTable(cookie);
    const alice = await joinAs(session.code, "Alice");
    await watch(alice, session.id);

    // Ending the session disconnects everyone, which must not then empty it:
    // nobody is coming back, and the game master may still be reading it.
    await fetch(`${base}/api/sessions/${session.id}/end`, authed(cookie, { method: "POST" }));

    await Bun.sleep(GRACE_MS * 3);
    expect(await roster(cookie, session.id)).toEqual(["Alice"]);
  });
});
