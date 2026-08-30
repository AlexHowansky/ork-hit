/**
 * Browser tests for the behaviour that only exists in a real page: the segment
 * panel and its segment filter, and player screens updating live without a
 * refresh.
 *
 * These start their own server and drive a real Chromium, so they are slower than
 * the rest of the suite. They are skipped automatically when Playwright's browser
 * binaries aren't installed (`bunx playwright install chromium`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Locator, Page } from "playwright";
import { serverOptions } from "../src/server/app.ts";
import { registerServer } from "../src/server/ws.ts";
import { gms } from "../src/db/queries.ts";
import { config } from "../src/lib/config.ts";
import { unique } from "./helpers.ts";

const PASSWORD = "a-sufficiently-long-password";
const email = `${unique("gm")}@example.com`;

let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve>;
let base: string;

/** Playwright is optional; without its browsers these tests sit out. */
async function launch(): Promise<Browser | null> {
  try {
    const { chromium } = await import("playwright");
    return await chromium.launch();
  } catch {
    return null;
  }
}

beforeAll(async () => {
  gms.create(email, await Bun.password.hash(PASSWORD, { algorithm: "argon2id" }));
  server = Bun.serve({ ...serverOptions, port: 0, development: false });
  registerServer(server as never);
  base = server.url.origin.replace(/\/$/, "");
  browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

/** A fresh browser signed in as the game master, on the library. */
async function signedInGm(): Promise<Page> {
  const page = await (await browser!.newContext()).newPage();
  await page.goto(base);

  await page.getByRole("tab", { name: "Game master" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/gm");
  return page;
}

/** Signs in and builds a campaign with three characters, all through the UI. */
async function gmWithSession(): Promise<{ page: Page; code: string; campaignName: string }> {
  const page = await signedInGm();

  // A campaign and three characters, created through the dialogs.
  const campaignName = unique("Campaign");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Create campaign" }).click();
  // The panel of *this* campaign: an account with campaigns already has one on
  // screen, and it blinks out while the new campaign is being fetched.
  await page.getByText(`Characters in ${campaignName}`).waitFor();

  // SPD and DEX are what the segment panel is built out of. The two heroes are
  // SPD 12 and so act in every segment, which keeps the turn walk in these tests
  // one press per character; Strahd is SPD 2 and acts only in segments 6 and 12,
  // which is what the segment filter has to have something to hide.
  //
  // Thorin carries an INIT bonus as well, so the character panel has a number
  // there that is not the zero every unfilled character reads as. It is small on
  // purpose: DEX+INIT orders them Elara 20, Thorin 18, Strahd 10, which is the
  // order the turn walk below is written against.
  const cast = [
    ["Thorin", "pc", 12, 15, 3],
    ["Elara", "pc", 12, 20, 0],
    ["Strahd", "npc", 2, 10, 0],
  ] as const;

  for (const [name, kind, speed, dexterity, initiative] of cast) {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Type").selectOption(kind);
    await page.getByLabel(/Character sheet/).setInputFiles({
      name: "sheet.html",
      mimeType: "text/html",
      buffer: Buffer.from(`<h1>${name}</h1><script>window.loaded = true;</script>`),
    });
    // Characteristics, so the session screens have totals to count down from.
    await page.getByLabel("SPD", { exact: true }).fill(String(speed));
    await page.getByLabel("DEX", { exact: true }).fill(String(dexterity));
    await page.getByLabel("INIT", { exact: true }).fill(String(initiative));
    await page.getByLabel("REC", { exact: true }).fill("8");
    await page.getByLabel("END", { exact: true }).fill("30");
    await page.getByLabel("STUN", { exact: true }).fill("25");
    await page.getByLabel("BODY", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Add character" }).last().click();
    await page.getByRole("button", { name, exact: true }).waitFor();
  }

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL("**/gm/sessions/**");
  const code = (await page.locator("code").first().innerText()).trim();

  // Starting a session brings the campaign's player characters in by itself, so
  // only the NPC is added by hand. DEX puts them in the order Elara, Thorin,
  // Strahd whichever way round they arrived.
  await page.getByRole("listitem").filter({ hasText: "Strahd" })
    .getByRole("button", { name: "Add" }).click();
  await stageCount(page, 3);

  return { page, code, campaignName };
}

/** Joins as a player and claims Thorin. */
async function playerIn(code: string, name: string, campaignName?: string): Promise<Page> {
  const page = await (await browser!.newContext()).newPage();
  await page.goto(`${base}/join?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Player name").fill(name);
  await page.getByRole("button", { name: "Join session" }).click();
  await page.getByText("Choose your character").waitFor();
  await page.getByRole("button", { name: "Thorin" }).click();
  // The session page is headed by the campaign, the same as the console is; who
  // the player is and who they are playing are on their own panel below.
  if (campaignName) {
    await page.getByRole("heading", { name: campaignName, exact: true }).waitFor();
  }
  // The players panel names the character each player holds, which is a different
  // id from the slot it sits in and was once matched against the wrong one.
  await page
    .locator("section", { hasText: /Players \(/ })
    .getByText("Playing Thorin")
    .waitFor();
  // The character they hold has a panel of its own, which is where their sheet
  // is reached from.
  const mine = page.locator("section", { hasText: /My character/ });
  await mine.getByText("Thorin", { exact: true }).waitFor();
  await mine.getByRole("button", { name: "My sheet" }).waitFor();
  // The four characteristics that are looked up rather than spent, in the order
  // the sheet reads them. INIT is the one that would go unnoticed if it were
  // dropped, since every character the rest of the suite makes has it at zero.
  await mine.getByText("SPD 12 · DEX 15 · INIT 3 · REC 8").waitFor();
  return page;
}

/**
 * The segment panel, on either screen.
 *
 * Matched on the shape of the heading rather than on its words, since the segment
 * in it changes as the fight walks the clock.
 */
const stagePanel = (page: Page) =>
  // Matched on the panel's own heading rather than on any text inside it: the
  // log names segments too, now that the clock writes a line each time the fight
  // reaches one, and a panel is what this wants rather than whatever mentions a
  // segment.
  page.locator("section").filter({ has: page.getByRole("heading", { name: /Segment \d+/ }) });

/**
 * Waits for the panel to hold `count` characters.
 *
 * Counted off the rows themselves, since the heading says only which segment the
 * fight is on. That makes this "how many rows are drawn" rather than "how many
 * are on the stage" — the two are the same only while the segment filter is
 * off, which every caller here is; the filter test does its own counting with
 * `namesIn`.
 *
 * Written as a retry loop because the number may still be crossing a socket and
 * bun:test's `expect` does not retry on its own. On timeout it asserts what it
 * last saw, so a failure says how many rows there actually were.
 */
const stageCount = async (page: Page, count: number) => {
  const deadline = Date.now() + 5000;
  let seen = -1;
  while (Date.now() < deadline) {
    seen = await stagePanel(page).locator("li").count();
    if (seen === count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(seen).toBe(count);
};

const namesIn = (page: Page) =>
  stagePanel(page)
    .locator("li")
    .evaluateAll((rows) => rows.map((row) => row.querySelector("span.truncate")?.textContent ?? ""));

/**
 * Drives a real HTML5 drag from one element to another.
 *
 * Playwright's own `dragAndDrop` works in pointer events, which native drag and
 * drop does not see; the sequence has to be dispatched by hand, sharing one
 * `DataTransfer` across it the way the browser would.
 */
async function dragCard(page: Page, from: string, to: string | "the character panel") {
  await page.evaluate(([source, target]: [string, string]) => {
    const panel = () =>
      [...document.querySelectorAll("section")].find((section) =>
        section.querySelector("h2")?.textContent?.startsWith("Characters in"),
      )!.children[1]!;
    const src = document.querySelector(source)!;
    const dst = target === "the character panel" ? panel() : document.querySelector(target)!;
    const dataTransfer = new DataTransfer();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      dst.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }
    src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
  }, [from, to] as [string, string]);
}

describe.skipIf(!process.env.CI && !process.env.E2E)("in a real browser", () => {
  test("a player's screen follows the game master with no refresh", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Alice", campaignName);

    // The player appears on the console without either side reloading.
    await gm.getByText("Alice").first().waitFor({ timeout: 5000 });

    // Turn marker.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Go now" }).click();
    await player.locator("p", { hasText: "Up now:" }).getByText("Strahd")
      .waitFor({ timeout: 5000 });

    // Walking off the end of segment 12 opens turn 2 on both screens.
    for (let i = 0; i < 3; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    await player.getByText("Turn 2", { exact: true }).waitFor({ timeout: 5000 });

    // Removing an NPC takes it off the player's list.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Remove" }).click();
    await stageCount(player, 2);
  }, 60_000);

  /**
   * Waits for a box to read a value, since the number may still be crossing a
   * socket. Playwright's own auto-retrying assertions are not bun:test's
   * `expect`, so the retry is written out.
   */
  const waitForValue = async (locator: Locator, expected: string) => {
    const deadline = Date.now() + 5000;
    let seen = "";
    while (Date.now() < deadline) {
      seen = (await locator.innerText()).trim();
      if (seen === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(seen).toBe(expected);
  };

  /** Presses a box and picks a change out of the dialog it opens. */
  const change = async (page: Page, box: Locator, amount: string) => {
    await box.click();
    await page.getByRole("dialog").getByRole("button", { name: amount, exact: true }).click();
  };

  test("what a character has left is edited from either screen", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Nia");

    const gmRow = stagePanel(gm)
      .getByRole("listitem").filter({ hasText: "Thorin" });
    const myPanel = player.locator("section", { hasText: /My character/ });

    // The game master's row carries the four looked-up characteristics, in the
    // same line the player reads on their own panel, and does not repeat who is
    // playing what — the players panel beside it already says.
    await gmRow.getByText("SPD 12 · DEX 15 · INIT 3 · REC 8").waitFor();
    expect(await gmRow.innerText()).not.toContain("Played by");

    // The player's scene is the other way round: who holds which character, and
    // nobody's characteristics but their own.
    const playerRow = stagePanel(player)
      .getByRole("listitem").filter({ hasText: "Thorin" });
    await playerRow.getByText("Played by Nia (you)").waitFor();
    expect(await playerRow.innerText()).not.toContain("SPD");

    // Both screens start at the totals the library carries.
    await waitForValue(gmRow.getByLabel("STUN left for Thorin"), "25");
    await waitForValue(myPanel.getByLabel("END left for Thorin"), "30");

    // The game master takes 18 STUN off Thorin — the change, not the total, is
    // what the dialog asks for — and the player's own panel follows.
    await change(gm, gmRow.getByLabel("STUN left for Thorin"), "−18");
    await waitForValue(gmRow.getByLabel("STUN left for Thorin"), "7");
    await waitForValue(myPanel.getByLabel("STUN left for Thorin"), "7");

    // The player spends their own ENDURANCE, and the console follows.
    await change(player, myPanel.getByLabel("END left for Thorin"), "−19");
    await waitForValue(gmRow.getByLabel("END left for Thorin"), "11");

    // An exact value is still reachable, for putting a mistake right.
    await myPanel.getByLabel("END left for Thorin").click();
    await player.getByRole("dialog").getByLabel("Or set it exactly").fill("11");
    await player.getByRole("dialog").getByRole("button", { name: "Set" }).click();
    await waitForValue(gmRow.getByLabel("END left for Thorin"), "11");

    // A Recovery gives REC back to both, and stops at the totals. The library
    // gave everyone REC 8, so 7 STUN comes back to 15 and END is already full.
    await gmRow.getByLabel("Take a Recovery for Thorin").click();
    await waitForValue(gmRow.getByLabel("STUN left for Thorin"), "15");
    await waitForValue(gmRow.getByLabel("END left for Thorin"), "19");

    // The player may take their own, from their own panel, and both screens see it.
    await myPanel.getByLabel("Take a Recovery for Thorin").click();
    await waitForValue(myPanel.getByLabel("END left for Thorin"), "27");
    await waitForValue(gmRow.getByLabel("STUN left for Thorin"), "23");

    // A rest puts both back to full, from either screen, and leaves BODY alone.
    await gmRow.getByLabel("Rest Thorin").click();
    await waitForValue(gmRow.getByLabel("END left for Thorin"), "30");
    await waitForValue(gmRow.getByLabel("STUN left for Thorin"), "25");
    await waitForValue(myPanel.getByLabel("BODY left for Thorin"), "12");

    // The scene carries none of these for a player: someone else's are not
    // theirs to see, and their own are on the panel above rather than twice.
    const scene = stagePanel(player);
    expect((await scene.innerText()).replace(/\s+/g, " ")).not.toContain("STUN");

    // And the game master still sees every row's.
    const strahdOnConsole = stagePanel(gm)
      .getByRole("listitem").filter({ hasText: "Strahd" });
    expect(await strahdOnConsole.getByLabel("STUN left for Strahd").count()).toBe(1);
  }, 60_000);

  test("an NPC can be brought on more than once, and each copy acts", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Gus");

    // Strahd is already on the stage once; two more makes three.
    const library = gm
      .locator("section")
      .filter({ has: gm.getByRole("heading", { name: "Library" }) });
    await library.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Add" }).click();
    await stageCount(gm, 4);
    await library.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Add" }).click();
    await stageCount(gm, 5);

    // The NPC stayed in the library — that is what lets it be added again — and
    // says how many of it are out.
    const strahdCard = library.getByRole("listitem").filter({ hasText: "Strahd" });
    expect(await strahdCard.count()).toBe(1);
    // The badge counts the copies already on the stage.
    expect((await strahdCard.innerText()).replace(/\s+/g, " ")).toContain("3");

    // Each copy is numbered, and the player sees the same numbers.
    const stage = stagePanel(gm);
    for (const n of ["1", "2", "3"]) {
      await stage.getByRole("listitem").filter({ hasText: `Strahd${n}` }).waitFor({ timeout: 5000 });
    }
    await stageCount(player, 5);

    // A full segment gives every copy its own phase rather than sticking on the first.
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(150);
      seen.push((await gm.locator("p", { hasText: "Up now:" }).innerText()).replace(/\s+/g, " "));
    }
    expect(seen.filter((line) => line.includes("Strahd"))).toHaveLength(3);
    expect(new Set(seen).size).toBe(5);

    // Removing the middle copy leaves the other two with the numbers they had.
    await stage.getByRole("listitem").filter({ hasText: "Strahd2" })
      .getByRole("button", { name: "Remove" }).click();
    await stageCount(gm, 4);
    await stage.getByRole("listitem").filter({ hasText: "Strahd1" }).waitFor({ timeout: 5000 });
    await stage.getByRole("listitem").filter({ hasText: "Strahd3" }).waitFor({ timeout: 5000 });
    expect(await stage.getByRole("listitem").filter({ hasText: "Strahd2" }).count()).toBe(0);
  }, 60_000);

  test("restarting takes both screens back to turn 1", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Fran");

    // Into turn 2, with a phase set, so there is something to go back from.
    for (let i = 0; i < 4; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    await player.getByText("Turn 2", { exact: true }).waitFor({ timeout: 5000 });

    // Restarting asks first, and backing out of the question changes nothing.
    await gm.getByRole("button", { name: "Restart" }).click();
    await gm.getByRole("dialog", { name: "Start over at turn 1?" })
      .getByRole("button", { name: "Cancel" }).click();
    await gm.waitForTimeout(200);
    expect(await gm.getByText("Turn 2", { exact: true }).count()).toBe(1);

    await gm.getByRole("button", { name: "Restart" }).click();
    await gm.getByRole("dialog", { name: "Start over at turn 1?" })
      .getByRole("button", { name: "Restart" }).click();

    // Turn one, nobody up, and the player sees it without a refresh.
    await gm.getByText("No turn set yet").waitFor({ timeout: 5000 });
    await player.getByText("Turn 1", { exact: true }).waitFor({ timeout: 5000 });
    await player.getByText("No turn set yet").waitFor({ timeout: 5000 });

    // The stage is untouched: the same three are still in the scene.
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);

    // And the next step opens turn one, segment twelve, at the top of the order.
    await gm.getByRole("button", { name: "Next" }).click();
    await gm.locator("p", { hasText: "Up now:" }).getByText("Elara")
      .waitFor({ timeout: 5000 });
    expect(await gm.getByText("Turn 1", { exact: true }).count()).toBe(1);
  }, 60_000);

  test("the player whose turn it is gets told", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Dana");

    // Nobody is up yet, so nothing has been announced.
    expect(await player.getByText("It's your turn!").count()).toBe(0);

    // An NPC's turn is not this player's business.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Go now" }).click();
    await player.locator("p", { hasText: "Up now:" }).getByText("Strahd")
      .waitFor({ timeout: 5000 });
    expect(await player.getByText("It's your turn!").count()).toBe(0);

    // Their own character's turn is.
    await gm.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByRole("button", { name: "Go now" }).click();
    await player.getByText("It's your turn!").waitFor({ timeout: 5000 });
  }, 60_000);

  test("the log is hidden until asked for, and says when the session began", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Dana", campaignName);

    /*
     * How much room the drawer is taking. Measured rather than asked, because a
     * collapsed drawer is still in the document — it is clipped to nothing by
     * `overflow-hidden`, which is what makes it slide rather than blink, and
     * Playwright's own visibility check does not look through that. The number
     * on screen is the honest question anyway: the whole promise of this drawer
     * is that closed, it costs the console nothing.
     */
    const drawerWidth = async (page: Page) =>
      (await page.locator("aside").boundingBox())?.width ?? 0;

    for (const page of [gm, player]) {
      // A 16:9 default viewport, so the drawer is a column and collapses
      // sideways.
      expect(await drawerWidth(page)).toBe(0);
      // Closed it is `inert` as well as clipped, so nothing in it can be
      // clicked or read out.
      expect(await page.locator("aside").getAttribute("inert")).not.toBeNull();

      // `exact`, because the drawer's own close button is also named for the log.
      const toggle = page.getByRole("button", { name: "Log", exact: true });

      await toggle.click();
      // Opening is a transition, so give it room to finish before measuring.
      await page.waitForTimeout(500);
      expect(await drawerWidth(page)).toBeGreaterThan(200);
      // The line was written before either of these screens existed: the console
      // had not opened its socket and the player had not been given the code. It
      // can only have come out of the database, on the snapshot.
      await page.locator("aside").getByText("Session started").waitFor({ timeout: 5000 });

      // All three ways out close it: the × in the drawer...
      await page.getByRole("button", { name: "Close the log" }).click();
      await page.waitForTimeout(500);
      expect(await drawerWidth(page)).toBe(0);

      // ...Escape, while it is open...
      await toggle.click();
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      expect(await drawerWidth(page)).toBe(0);

      // ...and the button that opened it.
      await toggle.click();
      await page.waitForTimeout(500);
      await toggle.click();
      await page.waitForTimeout(500);
      expect(await drawerWidth(page)).toBe(0);
    }
  }, 60_000);

  test("a player arriving writes itself onto the log, with no refresh", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();

    // The drawer is open *before* anybody joins, so what appears in it appears
    // because a snapshot arrived — not because the page was built again.
    await gm.getByRole("button", { name: "Log", exact: true }).click();
    const log = gm.locator("aside");
    await log.getByText("Session started").waitFor({ timeout: 5000 });
    expect(await log.getByText("Dana joined").count()).toBe(0);

    // `playerIn` joins and then claims Thorin, which is two events.
    await playerIn(code, "Dana", campaignName);

    await log.getByText("Dana joined").waitFor({ timeout: 5000 });
    await log.getByText("Dana selected Thorin").waitFor({ timeout: 5000 });
  }, 60_000);

  test("crossing segment 12 tells the whole table about the Recovery", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Dana", campaignName);

    // Segment 12 holds three phases — Elara, Thorin, Strahd — so the fourth press
    // is the one that leaves it, and nothing is announced before that.
    for (let i = 0; i < 3; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    expect(await player.getByText("Post-Segment 12 Recovery").count()).toBe(0);
    expect(await gm.getByText("Post-Segment 12 Recovery").count()).toBe(0);

    await gm.getByRole("button", { name: "Next" }).click();
    await gm.getByText("Post-Segment 12 Recovery").waitFor({ timeout: 5000 });
    await player.getByText("Post-Segment 12 Recovery").waitFor({ timeout: 5000 });
  }, 60_000);

  test("a condition set by the game master reaches the players", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Nia", campaignName);

    // Nothing on anybody yet.
    expect(await player.getByTitle("Prone").count()).toBe(0);

    const strahd = gm.getByRole("listitem").filter({ hasText: "Strahd" });
    await strahd.getByRole("button", { name: "Set Strahd's status" }).click();

    // The dialog stays open between presses: one hit commonly leaves a character
    // both prone and stunned.
    await gm.getByRole("button", { name: "Prone", exact: true }).click();
    await gm.getByRole("button", { name: "Stunned", exact: true }).click();
    await gm.getByRole("button", { name: "Close" }).click();

    await strahd.getByTitle("Prone").waitFor({ timeout: 5000 });
    await strahd.getByTitle(/Stunned/).waitFor({ timeout: 5000 });

    // And the player's scene follows without a reload.
    const theirStrahd = player.getByRole("listitem").filter({ hasText: "Strahd" });
    await theirStrahd.getByTitle("Prone").waitFor({ timeout: 5000 });

    // Taking it off again takes it off both screens.
    await strahd.getByRole("button", { name: "Set Strahd's status" }).click();
    await gm.getByRole("button", { name: "Prone", exact: true }).click();
    await gm.getByRole("button", { name: "Close" }).click();
    await theirStrahd.getByTitle("Prone").waitFor({ state: "detached", timeout: 5000 });
  }, 60_000);

  test("a player sets their own character's condition, and only theirs", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Omar", campaignName);

    // A player's scene is read-only: no control on anybody's row, their own
    // character included — theirs lives on their own panel.
    expect(await player.getByRole("button", { name: /Set .*'s status/ }).count()).toBe(1);

    await player.getByRole("button", { name: "Set Thorin's status" }).click();
    await player.getByRole("textbox", { name: "Add a tag" }).fill("On fire");
    await player.getByRole("button", { name: "Add", exact: true }).click();
    await player.getByRole("button", { name: "Close" }).click();

    // A typed tag keeps its word — on their own panel, on their row in the scene
    // beside it, and on the game master's row.
    await player.locator("section", { hasText: /My character/ })
      .getByTitle("On fire").waitFor({ timeout: 5000 });
    await player.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByTitle("On fire").waitFor({ timeout: 5000 });
    await gm.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByTitle("On fire").waitFor({ timeout: 5000 });
  }, 60_000);

  test("taking a played character out of the scene asks first", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Ivy");

    const stage = stagePanel(gm);

    // An NPC nobody is playing goes without a question.
    await stage.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: /Remove Strahd/ }).click();
    await stageCount(gm, 2);

    // Elara is a player character, but unclaimed — still no question.
    await stage.getByRole("listitem").filter({ hasText: "Elara" })
      .getByRole("button", { name: /Remove Elara/ }).click();
    await stageCount(gm, 1);

    // Thorin is being played, so this one is asked about — and refusing it
    // leaves the scene exactly as it was.
    await stage.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByRole("button", { name: /Remove Thorin/ }).click();
    const asking = gm.getByRole("dialog", { name: "Take Thorin out of the scene?" });
    await asking.getByText("Ivy is playing them").waitFor();
    await asking.getByRole("button", { name: "Cancel" }).click();
    await stageCount(gm, 1);

    // Going through with it drops the player back to choosing a character.
    await stage.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByRole("button", { name: /Remove Thorin/ }).click();
    await gm.getByRole("dialog", { name: "Take Thorin out of the scene?" })
      .getByRole("button", { name: "Remove" }).click();
    await stageCount(gm, 0);
    await player.getByText("Choose your character").waitFor({ timeout: 5000 });
  }, 60_000);

  test("the library keeps every character, blocked by who is in the scene", async () => {
    if (!browser) return;
    const { page: gm } = await gmWithSession();

    const library = gm
      .locator("section")
      .filter({ has: gm.getByRole("heading", { name: "Library" }) });
    const rowFor = (name: string) =>
      library.getByRole("listitem").filter({ hasText: name });

    // The name span, not the placeholder icon's — a character with no picture
    // draws one of those first.
    const namesInLibrary = () =>
      library.locator("li").evaluateAll((rows) =>
        rows.map((row) => row.querySelector("span.truncate")?.textContent ?? ""),
      );

    // Elara and Thorin came on with the session and Strahd was added by hand, so
    // all three are in the scene — and all three are still listed here, in the
    // first two blocks: heroes in the scene, then monsters in the scene.
    expect(await namesInLibrary()).toEqual(["Elara", "Thorin", "Strahd"]);

    // A hero already in the session cannot come on twice, so their Add is quiet.
    // A monster's never is — a fight can always want another goblin.
    const add = (name: string) => rowFor(name).getByRole("button", { name: "Add" });
    expect(await add("Elara").isDisabled()).toBe(true);
    expect(await add("Thorin").isDisabled()).toBe(true);
    expect(await add("Strahd").isDisabled()).toBe(false);

    // The count of how many are out is a monster's badge alone — a hero is on the
    // stage once, so a `1` beside them would be answering nothing.
    expect(await rowFor("Thorin").innerText()).not.toContain("1");
    expect(await rowFor("Strahd").innerText()).toContain("1");

    // How bright an element actually renders: opacity composites down the tree,
    // so a dimmed row means every ancestor's opacity multiplied together.
    const brightness = (target: Locator) =>
      target.evaluate((element) => {
        let value = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          value *= Number(window.getComputedStyle(node).opacity);
        }
        return value;
      });

    // Everyone is in the scene, so nothing is dimmed yet.
    expect(await brightness(rowFor("Strahd").locator("span.truncate"))).toBe(1);

    // Sheets are opened from here, not from the segment panel, and a character
    // who is not in the scene still has one to read.
    await rowFor("Strahd").getByRole("button", { name: "Sheet" }).click();
    await gm.locator("iframe").waitFor({ timeout: 5000 });
    await gm.keyboard.press("Escape");
    await gm.locator("iframe").waitFor({ state: "detached", timeout: 5000 });
    expect(
      await stagePanel(gm).getByRole("button", { name: "Sheet" }).count(),
    ).toBe(0);

    // Taking a hero off the stage gives their Add back, and drops them out of the
    // blocks that are in the scene — below the monster who still is.
    await stagePanel(gm).getByRole("listitem").filter({ hasText: "Elara" })
      .getByRole("button", { name: /Remove Elara/ }).click();
    await stageCount(gm, 2);
    expect(await add("Elara").isDisabled()).toBe(false);
    expect(await namesInLibrary()).toEqual(["Thorin", "Strahd", "Elara"]);

    // The rule above the first row out of the scene is heavier than the ones
    // between rows, so the boundary between the two halves is found at a glance.
    const ruleAbove = (name: string) =>
      rowFor(name).evaluate((row) => {
        const style = window.getComputedStyle(row);
        return { width: Number.parseFloat(style.borderTopWidth), colour: style.borderTopColor };
      });

    // In both themes, and by colour as well as by weight: a boundary that is only
    // a pixel heavier than the rule below it, in the same shade, is one nobody
    // can see. Checked in dark as well because that is exactly how it was missed.
    for (const theme of ["Light", "Dark"] as const) {
      await gm.getByRole("button", { name: theme, exact: true }).click();
      await gm.waitForTimeout(100);

      const boundary = await ruleAbove("Elara");
      const ordinary = await ruleAbove("Strahd");
      expect(boundary.width).toBeGreaterThan(ordinary.width);
      expect(boundary.colour).not.toBe(ordinary.colour);
    }

    // Out of the scene, so the row is dimmed — but not the control that would
    // bring them back, which is the whole point of a row in this state.
    expect(await brightness(rowFor("Elara").locator("span.truncate"))).toBeLessThan(1);
    expect(await brightness(add("Elara"))).toBe(1);
    expect(await brightness(rowFor("Thorin").locator("span.truncate"))).toBe(1);

    // And bringing them back puts them at the top again.
    await add("Elara").click();
    await stageCount(gm, 3);
    expect(await add("Elara").isDisabled()).toBe(true);
    expect(await namesInLibrary()).toEqual(["Elara", "Thorin", "Strahd"]);
    expect(await brightness(rowFor("Elara").locator("span.truncate"))).toBe(1);
  }, 60_000);

  test("the filter button narrows each screen to whoever is acting", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Bob");

    // The fight opens on segment 12, where all three act — DEX orders them.
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);
    expect(await namesIn(player)).toEqual(["Elara", "Thorin", "Strahd"]);

    // Four presses walks segment 12 and opens segment 1 of turn 2, which belongs
    // to the two SPD 12 heroes alone: Strahd is SPD 2 and has no phase there.
    for (let i = 0; i < 4; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    await gm.getByText("Segment 1", { exact: true }).waitFor({ timeout: 5000 });
    await player.getByText("Segment 1", { exact: true }).waitFor({ timeout: 5000 });

    // Everyone is still listed until the filter button is pressed.
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);

    const filterButton = (page: Page) =>
      stagePanel(page).getByRole("button", { name: /Show All|Show Acting/ });

    await filterButton(gm).click();
    await gm.waitForTimeout(200);
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin"]);

    // One reader's choice is their own: the player still sees everybody.
    expect(await namesIn(player)).toEqual(["Elara", "Thorin", "Strahd"]);

    // And the player has the same button, working the same way.
    await filterButton(player).click();
    await player.waitForTimeout(200);
    expect(await namesIn(player)).toEqual(["Elara", "Thorin"]);

    // It is one setting, not one per segment: walking on to a segment Strahd
    // does act in brings them back without the button being touched.
    // Two heroes a segment, so ten presses walks segments 1 to 5 and opens 6.
    for (let i = 0; i < 10; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    await gm.getByText("Segment 6", { exact: true }).waitFor({ timeout: 5000 });
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);

    // Remembered across a reload, for the length of the session. Three more
    // presses finish segment 6 — Strahd's second phase is in it — and open 7,
    // which is the heroes' alone again.
    await gm.reload();
    await gm.getByText("Segment 6", { exact: true }).waitFor({ timeout: 5000 });
    for (let i = 0; i < 3; i += 1) {
      await gm.getByRole("button", { name: "Next" }).click();
      await gm.waitForTimeout(120);
    }
    await gm.getByText("Segment 7", { exact: true }).waitFor({ timeout: 5000 });
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin"]);

    // Pressed again, the whole stage comes back.
    await filterButton(gm).click();
    await gm.waitForTimeout(200);
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);
  }, 60_000);

  test("the session console's columns can be dragged to a different balance", async () => {
    if (!browser) return;
    const { page: gm } = await gmWithSession();
    await gm.setViewportSize({ width: 1600, height: 900 });
    await gm.waitForTimeout(150);

    const panelWith = (name: string | RegExp) =>
      gm.locator("section").filter({ has: gm.getByRole("heading", { name }) });
    // Each panel fills the column it is in, so the panels are how the columns are
    // measured: the segment panel is the turn column, and the other two name
    // themselves.
    const turn = panelWith(/^Segment /);
    const library = panelWith("Library");
    const players = panelWith(/^Players/);
    const widthOf = async (panel: Locator) => (await panel.boundingBox())!.width;
    const columns = async () =>
      [await widthOf(turn), await widthOf(library), await widthOf(players)];

    const handles = {
      turn: gm.getByRole("separator", { name: "Resize the turn column" }),
      library: gm.getByRole("separator", { name: "Resize the library column" }),
    };
    const drag = async (handle: Locator, by: number) => {
      const box = (await handle.boundingBox())!;
      const y = box.y + box.height / 2;
      await gm.mouse.move(box.x + box.width / 2, y);
      await gm.mouse.down();
      await gm.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
      await gm.mouse.up();
      await gm.waitForTimeout(100);
    };

    // Three columns, equal until somebody says otherwise.
    const [wasTurn, wasLibrary, wasPlayers] = await columns();
    expect(Math.abs(wasTurn! - wasLibrary!)).toBeLessThan(2);
    expect(Math.abs(wasLibrary! - wasPlayers!)).toBeLessThan(2);
    const total = wasTurn! + wasLibrary! + wasPlayers!;

    // The turn's boundary takes from everything to its right, which is still
    // sharing what is left equally, so the two beyond it give up half each.
    await drag(handles.turn, 140);
    let [nowTurn, nowLibrary, nowPlayers] = await columns();
    expect(nowTurn!).toBeCloseTo(wasTurn! + 140, -1);
    expect(nowTurn! + nowLibrary! + nowPlayers!).toBeCloseTo(total, -1);

    // The library's boundary is between the last two and leaves the first alone.
    const beforeSecond = nowTurn!;
    await drag(handles.library, 90);
    [nowTurn, nowLibrary, nowPlayers] = await columns();
    expect(nowTurn!).toBeCloseTo(beforeSecond, -1);
    expect(nowLibrary!).toBeCloseTo(total - beforeSecond - nowPlayers!, -1);
    expect(nowPlayers!).toBeLessThan(wasPlayers!);

    // Dragged to the edge, the columns beyond keep their floor — a sixth of the
    // console each — rather than being crushed out of existence.
    await drag(handles.turn, 2000);
    [nowTurn, nowLibrary, nowPlayers] = await columns();
    expect(nowLibrary!).toBeGreaterThan(total / 6 - 2);
    expect(nowPlayers!).toBeGreaterThan(total / 6 - 2);

    // And each boundary gives its column back on a double-click.
    await handles.turn.dblclick();
    await handles.library.dblclick();
    await gm.waitForTimeout(150);
    const [again, andAgain] = await columns();
    expect(again!).toBeCloseTo(wasTurn!, -1);
    expect(andAgain!).toBeCloseTo(wasLibrary!, -1);

    // Two halves rather than a dashboard: the turn's boundary is still there and
    // still drags, and the library's — which only splits two of three columns —
    // is not.
    await gm.setViewportSize({ width: 900, height: 1200 });
    await gm.waitForTimeout(200);
    expect(await handles.library.isVisible()).toBe(false);
    const half = await widthOf(turn);
    await drag(handles.turn, -80);
    expect(await widthOf(turn)).toBeCloseTo(half - 80, -1);

    // Stacked, there is nothing to resize at all.
    await gm.setViewportSize({ width: 500, height: 900 });
    await gm.waitForTimeout(200);
    expect(await handles.turn.isVisible()).toBe(false);
  }, 60_000);

  test("the library's two columns can be dragged to a different balance", async () => {
    if (!browser) return;
    const gm = await signedInGm();
    await gm.setViewportSize({ width: 1600, height: 900 });

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    const panelWith = (name: string | RegExp) =>
      gm.locator("section").filter({ has: gm.getByRole("heading", { name }) });
    const campaigns = panelWith("Campaigns");
    const characters = panelWith(/^Characters in /);
    const handle = gm.getByRole("separator", { name: "Resize the campaigns column" });
    const widthOf = async (panel: Locator) => (await panel.boundingBox())!.width;

    await handle.waitFor();
    // Where the automatic fit left it: the width that holds a whole number of
    // card columns. Noted so the reset at the end can be checked against it.
    const fitted = await widthOf(campaigns);
    const together = fitted + (await widthOf(characters));

    const drag = async (by: number) => {
      const box = (await handle.boundingBox())!;
      const y = box.y + box.height / 2;
      await gm.mouse.move(box.x + box.width / 2, y);
      await gm.mouse.down();
      await gm.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
      await gm.mouse.up();
      await gm.waitForTimeout(100);
    };

    // What the campaign panel takes, the character panel gives up: the two still
    // fill the same room between them.
    await drag(150);
    expect(await widthOf(campaigns)).toBeCloseTo(fitted + 150, -1);
    expect((await widthOf(campaigns)) + (await widthOf(characters))).toBeCloseTo(together, -1);

    // Dragged off the left edge, the panel stops at one whole card rather than
    // collapsing — the minimum is the card track, measured, not a number here.
    const cardWidth = (await gm
      .locator(`article:has(button[aria-label="Select ${campaignName}"])`)
      .boundingBox())!.width;
    await drag(-2000);
    const squeezed = await widthOf(campaigns);
    expect(squeezed).toBeGreaterThan(cardWidth);
    expect(squeezed).toBeLessThan(cardWidth + 100);

    // And the automatic fit takes the width back when the handle is given back.
    await handle.dblclick();
    await gm.waitForTimeout(100);
    expect(await widthOf(campaigns)).toBeCloseTo(fitted, -1);

    // Stacked, there is nothing to resize and no handle to reach.
    await gm.setViewportSize({ width: 800, height: 1400 });
    await gm.waitForTimeout(150);
    expect(await handle.isVisible()).toBe(false);
  }, 60_000);

  test("a card leaves the row only once it no longer fits", async () => {
    if (!browser) return;
    const gm = await signedInGm();
    await gm.setViewportSize({ width: 1600, height: 900 });

    const names = [unique("Campaign"), unique("Campaign"), unique("Campaign")];
    for (const name of names) {
      await gm.getByRole("button", { name: "New", exact: true }).click();
      await gm.getByLabel("Campaign name").fill(name);
      await gm.getByRole("button", { name: "Create campaign" }).click();
      await gm.getByText(`Characters in ${name}`).waitFor();
    }

    const campaigns = gm
      .locator("section")
      .filter({ has: gm.getByRole("heading", { name: "Campaigns" }) });
    const cards = campaigns.locator("article");
    const handle = gm.getByRole("separator", { name: "Resize the campaigns column" });
    await handle.waitFor();

    /** The margins the cards sit in, and how many of them share the top row. */
    const layout = async () => {
      const panel = (await campaigns.boundingBox())!;
      const boxes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top };
        }),
      );
      const top = Math.min(...boxes.map((box) => box.top));
      const row = boxes.filter((box) => Math.abs(box.top - top) < 1);
      return {
        columns: row.length,
        before: Math.min(...row.map((box) => box.left)) - panel.x,
        after: panel.x + panel.width - Math.max(...row.map((box) => box.right)),
      };
    };

    // Flush against the last column, the cards sit in the same margin on both
    // sides. A reserved-but-unused scrollbar gutter used to make the right one
    // twice the left, and cost the next card the room it needed besides.
    const fitted = await layout();
    expect(fitted.columns).toBeGreaterThan(1);
    expect(Math.abs(fitted.after - fitted.before)).toBeLessThan(2);

    // What another column would cost: a card and the gap before it, measured off
    // the two that are on screen rather than assumed, since the deployment picks
    // how large a card is drawn.
    const [first, second] = await cards.evaluateAll((nodes) =>
      nodes.slice(0, 2).map((node) => node.getBoundingClientRect()),
    );
    const step = second!.left - first!.left;

    const drag = async (by: number) => {
      const box = (await handle.boundingBox())!;
      const y = box.y + box.height / 2;
      await gm.mouse.move(box.x + box.width / 2, y);
      await gm.mouse.down();
      await gm.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
      await gm.mouse.up();
      await gm.waitForTimeout(100);
    };

    // Room for all but a sliver of another card is not room for another card, and
    // giving nearly all of that room back does not cost the row a card either.
    await drag(step - 24);
    expect((await layout()).columns).toBe(fitted.columns);
    await drag(-(step - 36));
    expect((await layout()).columns).toBe(fitted.columns);

    // Only once the drag passes the width the last card needs does the row lose it.
    await drag(-24);
    expect((await layout()).columns).toBe(fitted.columns - 1);
  }, 60_000);

  test("cards are drawn at the size the deployment asked for", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    // The picture is what the setting measures, so the picture is what is
    // measured here: the square image well of a card, in CSS pixels.
    // The well is found by its own shape rather than through a control inside it.
    // It used to hold a full-bleed select button whose box was the picture's box,
    // but the card tilts now (`HoverCard`) and the whole card is the select
    // control, so that button's box is the card's.
    const campaignCard = `article:has(button[aria-label="Select ${campaignName}"])`;
    const well = gm.locator(`${campaignCard} .aspect-square`).first();
    const box = (await well.boundingBox())!;

    expect(Math.round(box.width)).toBe(config.cardImagePx);
    // Square, and the card around it is taller than its picture — the border and
    // the name below it are extra, as the setting's documentation promises.
    expect(Math.round(box.height)).toBe(config.cardImagePx);
    const card = (await well.locator("xpath=ancestor::article[1]").boundingBox())!;
    expect(card.height).toBeGreaterThan(box.height);

    // And the card is a playing card: five wide by seven tall, with the square
    // picture the top five of those sevens and the name strip the bottom two.
    expect(card.height / card.width).toBeCloseTo(7 / 5, 2);
    expect((card.height - box.height) / card.width).toBeCloseTo(2 / 5, 1);

    // A campaign card is framed too, in its own artwork rather than the
    // character frame — which is how the two kinds of card tell themselves apart.
    const campaignFrame = gm.locator(`${campaignCard} .card-frame`);
    await campaignFrame.waitFor();
    expect(
      await campaignFrame.evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("/frames/campaign-light.png");
  }, 60_000);

  test("a character card is printed in the frame, with its name on the panel", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    await gm.getByRole("button", { name: "Add", exact: true }).click();
    await gm.getByLabel("Name").fill("Framed");
    await gm.getByLabel(/Character sheet/).setInputFiles({
      name: "sheet.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Framed</h1>"),
    });
    await gm.getByRole("button", { name: "Add character" }).last().click();
    await gm.getByRole("button", { name: "Framed", exact: true }).waitFor();

    const card = gm.locator(`article:has(button[aria-label="Framed"])`);
    const frame = card.locator(".card-frame");
    await frame.waitFor();

    // The artwork is actually resolved rather than left as an unset variable —
    // its address arrives from /appearance.css, so this fails if that is missing.
    const image = await frame.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(image).toContain("/frames/character-light.png");

    // It covers the card but for its border, so its window lands where the art
    // expects. The border is deliberately left showing: it is the hover and
    // keyboard-focus highlight, and art painted over it would take that away.
    const cardBox = (await card.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    const border = await card
      .locator(".card")
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth));
    expect(border).toBeGreaterThan(0);
    expect(frameBox.width).toBeCloseTo(cardBox.width - 2 * border, 0);
    expect(frameBox.height).toBeCloseTo(cardBox.height - 2 * border, 0);

    // And the name sits on the panel the art paints, whose centre is 82% of the
    // way down the card — not in the card's own bottom two sevenths, which would
    // put it over the frame's lower border.
    const name = (await card.getByText("Framed", { exact: true }).boundingBox())!;
    const centre = (name.y + name.height / 2 - cardBox.y) / cardBox.height;
    expect(centre).toBeCloseTo(0.82, 1);

    // The kind badge is on that panel too, tucked into its upper right — not over
    // the picture, where it used to be and would now compete with the artwork.
    // Both bounds matter: inside the panel's top edge (67.8%) and short of where
    // the frame's border begins (96.3%), but close enough to both to read as being
    // in the corner rather than floating near it. Note the panel carries a
    // decorative outline about 90% across, which is not its edge — the badge is
    // meant to sit outside that, against the border.
    const badge = (await card.getByText("PC", { exact: true }).boundingBox())!;
    const badgeTop = (badge.y - cardBox.y) / cardBox.height;
    const badgeRight = (badge.x + badge.width - cardBox.x) / cardBox.width;
    expect(badgeTop).toBeGreaterThan(0.679);
    expect(badgeTop).toBeLessThan(0.70);
    expect(badgeRight).toBeGreaterThan(0.92);
    expect(badgeRight).toBeLessThan(0.96);

    // The corner controls are bare glyphs stacked down the picture's top right,
    // inside the bevel that keeps the window's own corner out of reach: on the
    // darker template the window does not begin until y=5% at x=95.5%.
    const control = async (name: RegExp) =>
      (await card.getByRole("button", { name }).boundingBox())!;
    const view = await control(/^View /);
    const edit = await control(/^Edit /);
    const bin = await control(/^Delete /);

    // The stack is right up against the frame — its right edge is 96% of the way
    // across, which is as far as the bevelled corner allows the glyph to go.
    for (const b of [view, edit, bin]) {
      const right = (b.x + b.width - cardBox.x) / cardBox.width;
      expect(right).toBeGreaterThan(0.94);
      expect(right).toBeLessThan(0.965);
    }
    expect((view.y - cardBox.y) / cardBox.height).toBeGreaterThan(0.05);
    expect((view.y - cardBox.y) / cardBox.height).toBeLessThan(0.10);
    // In that order, top to bottom, in one column.
    expect(view.y).toBeLessThan(edit.y);
    expect(edit.y).toBeLessThan(bin.y);
    expect(edit.x).toBe(view.x);
    expect(bin.x).toBe(view.x);
    // And the whole stack stays inside the window, clear of the divider at 64%.
    expect((bin.y + bin.height - cardBox.y) / cardBox.height).toBeLessThan(0.63);

    // No pill behind them. Without this the placement above would still pass with
    // the old buttons, so this is what pins the look rather than the position.
    const fill = await card
      .getByRole("button", { name: /^Delete / })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toBe("rgba(0, 0, 0, 0)");
  }, 60_000);

  test("the corner controls tilt with the card, and still work while it is tilted", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    const card = gm.locator(`article:has(button[aria-label="Select ${campaignName}"])`);
    await card.waitFor();
    const transforms = () =>
      card.evaluate((el) => ({
        tile: getComputedStyle(el.querySelector(".card")!).transform,
        actions: getComputedStyle(el.querySelector(".card-actions-3d")!).transform,
      }));

    // Untouched, both are flat.
    const resting = await transforms();
    expect(resting.tile).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(resting.actions).toBe(resting.tile);

    // Hovered in a corner, the controls take the card's own rotation — exactly,
    // which is what stops them sliding across the face they are printed on. The
    // controls sit outside the tilting element (a transform makes it a stacking
    // context, so nothing inside it can be clicked) and are moved to match.
    await card.locator(".hover-3d > *").nth(1).hover();
    await gm.waitForTimeout(800);
    const tilted = await transforms();
    expect(tilted.tile).toStartWith("matrix3d(");
    expect(tilted.actions).toBe(tilted.tile);

    // And the whole point: a control is still a control at that angle.
    await card.getByRole("button", { name: `Edit ${campaignName}` }).click();
    const dialog = gm.getByRole("dialog");
    await dialog.waitFor();
    expect(await dialog.isVisible()).toBe(true);
  }, 60_000);

  test("the character form asks for the sheet first", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();
    await gm.getByRole("button", { name: "Add", exact: true }).click();

    // Every field is a label whose first span is its caption, so reading them in
    // document order is reading the form.
    const captions = await gm
      .locator("form label")
      .evaluateAll((labels) =>
        labels.map((label) => label.querySelector("span")?.textContent?.trim() ?? ""),
      );
    expect(captions).toEqual([
      "Character sheet (HTML file)",
      "Name",
      "Type",
      "Campaign",
      // The characteristics, read across in the order HERO prints them.
      "SPD",
      "DEX",
      "INIT",
      "REC",
      "END",
      "STUN",
      "BODY",
      "Background image (optional)",
    ]);
  }, 60_000);

  test("a sheet dropped on the character panel opens the form holding it", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    // A real drop on the panel itself, nowhere near the dialog — which is not
    // even open yet. The panel is found and dropped on inside one evaluation:
    // resolving it in an earlier round trip can hand back a node React has since
    // replaced, and an event dispatched at a detached node reaches nothing.
    await gm.evaluate(() => {
      const panel = Array.from(document.querySelectorAll("section")).find((section) =>
        section.textContent?.startsWith("Characters in"),
      );
      if (!panel) throw new Error("the character panel is not on the page");

      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["<h1>Gimli</h1>"], "Gimli son of Gloin.html", { type: "text/html" }),
      );
      panel.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
      panel.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });

    // The dialog opens already holding the file, named after it.
    await gm.getByRole("dialog", { name: "Add character" }).waitFor();
    await gm.getByText("Ready to upload: Gimli son of Gloin.html").waitFor();
    expect(await gm.getByLabel("Name").inputValue()).toBe("Gimli son of Gloin");

    // And that file is the one the form submits.
    await gm.getByRole("button", { name: "Add character" }).last().click();
    await gm.getByRole("button", { name: "Gimli son of Gloin", exact: true }).waitFor();
    await gm.getByRole("button", { name: "View Gimli son of Gloin's sheet" }).waitFor();
  }, 60_000);

  test("uploading a sheet names the character after the file", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    await gm.getByRole("button", { name: "Add", exact: true }).click();
    await gm.getByLabel(/Character sheet/).setInputFiles({
      name: "Bilbo Baggins.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Bilbo</h1>"),
    });

    // The name is filled in from the file, extension and all else left behind.
    expect(await gm.getByLabel("Name").inputValue()).toBe("Bilbo Baggins");

    // A second file replaces a name that only came from the first.
    await gm.getByLabel(/Character sheet/).setInputFiles({
      name: "Frodo Baggins.htm",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Frodo</h1>"),
    });
    expect(await gm.getByLabel("Name").inputValue()).toBe("Frodo Baggins");

    // But not a name the game master typed themselves.
    await gm.getByLabel("Name").fill("Samwise");
    await gm.getByLabel(/Character sheet/).setInputFiles({
      name: "Meriadoc.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Merry</h1>"),
    });
    expect(await gm.getByLabel("Name").inputValue()).toBe("Samwise");

    await gm.getByRole("button", { name: "Add character" }).last().click();
    await gm.getByRole("button", { name: "Samwise", exact: true }).waitFor();

    // Replacing the sheet of a character that already has a name leaves it alone.
    await gm.getByRole("button", { name: "Edit Samwise" }).click();
    await gm.getByLabel(/Character sheet/).setInputFiles({
      name: "Peregrin.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Pippin</h1>"),
    });
    expect(await gm.getByLabel("Name").inputValue()).toBe("Samwise");
  }, 60_000);

  test("a character sheet can be dropped onto the form instead of picked", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New", exact: true }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    await gm.getByRole("button", { name: "Add", exact: true }).click();
    await gm.getByLabel("Name").fill("Dropped");

    // A real drop, not `setInputFiles`: the point of the feature is that the
    // dropped file ends up in the input the form submits. The event goes to the
    // input and bubbles to the zone around it, as a drop on the zone would.
    const zone = gm.getByLabel(/Character sheet/);
    await zone.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["<h1>Dropped</h1>"], "dropped.html", { type: "text/html" }),
      );
      element.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });
    await gm.getByText("Ready to upload: dropped.html").waitFor();

    await gm.getByRole("button", { name: "Add character" }).last().click();
    await gm.getByRole("button", { name: "Dropped", exact: true }).waitFor();

    // The sheet went up with it, so the card offers to open one.
    await gm.getByRole("button", { name: "View Dropped's sheet" }).waitFor();
  }, 60_000);

  test("the session list follows a session started and ended in another tab", async () => {
    if (!browser) return;
    // Two tabs of the same game master: one sitting on the library, one working.
    const watcher = await signedInGm();
    const other = await signedInGm();

    const name = unique("Campaign");
    await other.getByRole("button", { name: "New", exact: true }).click();
    await other.getByLabel("Campaign name").fill(name);
    await other.getByRole("button", { name: "Create campaign" }).click();
    await other.getByText(`Characters in ${name}`).waitFor();

    const listed = watcher
      .locator("section", { hasText: "Sessions in progress" })
      .getByText(name);
    expect(await listed.count()).toBe(0);

    // The watching tab is never reloaded, and never touched at all.
    await other.getByRole("button", { name: "Start", exact: true }).click();
    await other.waitForURL("**/gm/sessions/**");
    await listed.waitFor({ timeout: 5000 });

    // Wait for the console's own furniture, not just the URL: the address
    // changes before React swaps the markup, and until it does this tab is still
    // showing the library — where "End" is one button per session in progress
    // rather than the console's single one, and the click below is ambiguous.
    await stagePanel(other).waitFor({ timeout: 5000 });

    await other.getByRole("button", { name: "End", exact: true }).click();
    // The dialog spells the action out where the button on the console is a
    // single word, so the second click is scoped to the dialog either way.
    const ending = other.getByRole("dialog", { name: "End this session?" });
    await ending.getByRole("button", { name: "End session" }).click();
    await other.waitForURL("**/gm");
    await listed.waitFor({ state: "detached", timeout: 5000 });
  }, 60_000);

  test("signing out of the console leaves the session running", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Hana");

    // Signing out is not ending: it is about this browser and nobody else's,
    // which is why the console asks nothing before doing it.
    await gm.getByRole("button", { name: "Sign out" }).click();
    await gm.getByRole("tab", { name: "Game master" }).waitFor({ timeout: 5000 });

    // The player is still at the table, on a session that is still running.
    await player.getByRole("heading", { name: campaignName, exact: true }).waitFor();

    // And signing back in finds it where it was left, still in progress and
    // still waiting to be opened.
    await gm.getByRole("tab", { name: "Game master" }).click();
    await gm.getByLabel("Email").fill(email);
    await gm.getByLabel("Password").fill(PASSWORD);
    await gm.getByRole("button", { name: "Sign in" }).click();
    await gm.waitForURL("**/gm");

    const row = gm.locator("li").filter({ hasText: campaignName });
    await row.getByRole("button", { name: "Open", exact: true }).click();
    await gm.waitForURL("**/gm/sessions/**");
    // The same code, so it is the same session and not a new one.
    await gm.getByText(code).waitFor({ timeout: 5000 });
  }, 60_000);

  test("a session can be ended from the library, without opening its console", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Hana");

    await gm.getByRole("button", { name: "Library" }).click();
    await gm.waitForURL("**/gm");

    // Other tests of this same game master leave sessions running, so the row has
    // to be found by its own campaign rather than by being the only one.
    const row = gm.locator("li").filter({ hasText: campaignName });
    await row.getByRole("button", { name: "End", exact: true }).click();

    // The question names the campaign, since the library can be showing several.
    const ending = gm.getByRole("dialog", { name: `End the session on “${campaignName}”?` });
    await ending.getByRole("button", { name: "End session" }).click();

    // The row goes on its own — nothing reloads the library.
    await row.waitFor({ state: "detached", timeout: 5000 });

    // And the table really is closed: the player is told, not just left hanging.
    await player.getByText("The session has ended").waitFor({ timeout: 5000 });
  }, 60_000);

  test("backing out of that leaves the session running", async () => {
    if (!browser) return;
    const { page: gm, campaignName } = await gmWithSession();

    await gm.getByRole("button", { name: "Library" }).click();
    await gm.waitForURL("**/gm");

    const row = gm.locator("li").filter({ hasText: campaignName });
    await row.getByRole("button", { name: "End", exact: true }).click();
    await gm.getByRole("dialog", { name: `End the session on “${campaignName}”?` })
      .getByRole("button", { name: "Cancel" }).click();

    await gm.waitForTimeout(300);
    expect(await row.getByRole("button", { name: "Open", exact: true }).count()).toBe(1);
  }, 60_000);

  test("a player who closes their browser leaves the table", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Erin");

    // Scoped to the players panel, because the log now names Erin too — and it
    // goes on naming her after she has gone, which is the point of it.
    const seat = gm.locator("section", { hasText: /Players \(/ }).getByText("Erin");
    await seat.first().waitFor({ timeout: 5000 });

    // No goodbye of any kind: the window simply goes, as it does when someone
    // shuts their laptop at the end of the evening.
    await player.context().close();

    // The game master's console empties the seat on its own, and Thorin — the
    // character Erin was holding — is free for someone else to take.
    await seat.first().waitFor({ state: "detached", timeout: 10_000 });
    await gm
      .getByRole("listitem")
      .filter({ hasText: "Thorin" })
      .getByText("Unclaimed")
      .waitFor({ timeout: 10_000 });
  }, 60_000);

  test("a sheet's scripts run but cannot touch the app", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Carol");

    await player.getByRole("button", { name: "My sheet" }).click();
    const frame = player.frameLocator("iframe");
    await frame.getByText("Thorin").waitFor({ timeout: 5000 });

    // The sheet's own script executed inside the frame...
    const ran = await player
      .frames()
      .find((entry) => entry.url().includes("/sheets/"))!
      .evaluate(() => (window as unknown as { loaded?: boolean }).loaded === true);
    expect(ran).toBe(true);

    // ...but the frame is an opaque origin. Reading cookies from it does not
    // merely come back empty — the browser refuses outright, which is exactly
    // the boundary the sandbox is there to draw.
    const cookieAccess = await player
      .frames()
      .find((entry) => entry.url().includes("/sheets/"))!
      .evaluate(() => {
        try {
          return { blocked: false, value: document.cookie };
        } catch (error) {
          return { blocked: true, value: (error as Error).name };
        }
      })
      .catch(() => ({ blocked: true, value: "SecurityError" }));

    expect(cookieAccess.blocked).toBe(true);

    await gm.close();
  }, 60_000);

  test("a character is refiled by dragging its card onto a campaign", async () => {
    if (!browser) return;
    const page = await signedInGm();
    await page.setViewportSize({ width: 1600, height: 900 });

    const [alpha, beta] = [unique("Alpha"), unique("Beta")];
    for (const name of [alpha, beta]) {
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByLabel("Campaign name").fill(name);
      await page.getByRole("button", { name: "Create campaign" }).click();
      await page.getByText(`Characters in ${name}`).waitFor();
    }

    await page.getByRole("button", { name: `Select ${alpha}` }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Name").fill("Thorin");
    await page.getByLabel(/Character sheet/).setInputFiles({
      name: "thorin.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Thorin</h1>"),
    });
    await page.getByRole("button", { name: "Add character" }).last().click();
    await page.getByRole("button", { name: "Thorin", exact: true }).waitFor();

    const card = `article:has(button[aria-label="View Thorin's sheet"])`;
    const cardOf = (name: string) => `article:has(button[aria-label="Select ${name}"])`;

    // The campaign it is already in must not offer to take it.
    await page.evaluate(([source, target]: [string, string]) => {
      const dataTransfer = new DataTransfer();
      document.querySelector(source)!
        .dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      document.querySelector(target)!
        .dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    }, [card, cardOf(alpha)] as [string, string]);
    expect(await page.locator(cardOf(alpha)).getAttribute("class")).not.toContain("ring-offset-2");

    // Another one lights up while the drag is over it.
    await page.evaluate(([source, target]: [string, string]) => {
      const dataTransfer = new DataTransfer();
      document.querySelector(source)!
        .dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      document.querySelector(target)!
        .dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    }, [card, cardOf(beta)] as [string, string]);
    await page.waitForTimeout(100);
    expect(await page.locator(cardOf(beta)).getAttribute("class")).toContain("ring-offset-2");

    // Dropping moves it: it leaves the panel it was in and turns up in the other.
    await dragCard(page, card, cardOf(beta));
    await page.getByText(`Moved “Thorin” to “${beta}”`).waitFor({ timeout: 5000 });
    expect(await page.getByRole("button", { name: "Thorin", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: `Select ${beta}` }).click();
    await page.getByRole("button", { name: "Thorin", exact: true }).waitFor();

    // A card let go over the character panel is not a sheet being uploaded.
    await dragCard(page, card, "the character panel");
    await page.waitForTimeout(400);
    expect(await page.getByLabel("Type").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Thorin", exact: true }).count()).toBe(1);

    // ...and a file let go there still is.
    await page.evaluate(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File(["<h1>Bilbo</h1>"], "Bilbo Baggins.html", { type: "text/html" }),
      );
      const panel = [...document.querySelectorAll("section")].find((section) =>
        section.querySelector("h2")?.textContent?.startsWith("Characters in"),
      )!.children[1]!;
      for (const type of ["dragover", "drop"]) {
        panel.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      }
    });
    await page.getByLabel("Name").waitFor({ timeout: 5000 });
    expect(await page.getByLabel("Name").inputValue()).toBe("Bilbo Baggins");

    await page.close();
  }, 60_000);

  test("a sheet opens over the window in the window's own shape", async () => {
    if (!browser) return;
    const page = await signedInGm();
    await page.setViewportSize({ width: 1600, height: 900 });

    const campaign = unique("Campaign");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByLabel("Campaign name").fill(campaign);
    await page.getByRole("button", { name: "Create campaign" }).click();
    await page.getByText(`Characters in ${campaign}`).waitFor();

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Name").fill("Thorin");
    await page.getByLabel(/Character sheet/).setInputFiles({
      name: "thorin.html",
      mimeType: "text/html",
      buffer: Buffer.from("<h1>Thorin</h1>"),
    });
    await page.getByRole("button", { name: "Add character" }).last().click();
    await page.getByRole("button", { name: "Thorin", exact: true }).waitFor();

    await page.getByRole("button", { name: "View Thorin's sheet" }).click();
    await page.locator("iframe").waitFor();

    // Whatever shape the window is, the sheet is the same shape. Nothing of ours
    // is drawn around it.
    for (const [width, height] of [[1600, 900], [1200, 1000], [800, 1400]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await page.waitForTimeout(150);
      const shown = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!;
        const box = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return {
          size: [box.width, box.height],
          window: [window.innerWidth, window.innerHeight],
          border: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          headings: document.querySelectorAll('[role="dialog"] h2').length,
        };
      });
      // The same ratio as the window, at whatever fraction of it the deployment
      // asked for — asserted as a ratio so the default can move without this
      // test having to know what it is.
      const [frameW, frameH] = shown.size as [number, number];
      const [windowW, windowH] = shown.window as [number, number];
      expect(frameW / frameH).toBeCloseTo(windowW / windowH, 3);
      expect(frameW).toBeLessThanOrEqual(windowW);
      expect(shown.border).toBe("0px");
      expect(shown.radius).toBe("0px");
      expect(shown.headings).toBe(0);
    }

    // The setting is one number and it moves both dimensions together, so the
    // shape survives whatever the deployment picks — including filling the window.
    await page.setViewportSize({ width: 1600, height: 900 });
    for (const [size, expected] of [[80, [1280, 720]], [100, [1600, 900]]] as const) {
      await page.evaluate(
        (value: string) => document.documentElement.style.setProperty("--sheet-size", value),
        String(size),
      );
      await page.waitForTimeout(150);
      const scaled = await page.evaluate(() => {
        const box = document.querySelector("iframe")!.getBoundingClientRect();
        return [box.width, box.height];
      });
      expect(scaled).toEqual([...expected]);
    }

    // The close control sits in the window's corner, not the sheet's, so it does
    // not move when the sheet is drawn at a different size.
    await page.evaluate(() => document.documentElement.style.setProperty("--sheet-size", "90"));
    await page.waitForTimeout(150);
    const corner = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Close"]')!.getBoundingClientRect();
      const sheet = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
      return { top: button.top, right: window.innerWidth - button.right, sheetTop: sheet.top };
    });
    expect(corner.top).toBeLessThan(corner.sheetTop);
    expect(corner.right).toBeLessThan(16);

    // Escape closes it, while the keyboard is still this page's to hear. Once a
    // reader clicks into the sheet the focus is inside a sandboxed cross-origin
    // frame and no key reaches us again, which is why the button is always there.
    expect(await page.getByRole("button", { name: "Close" }).count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    expect(await page.locator("iframe").count()).toBe(0);

    // A click on the sheet itself is the sheet's own business...
    await page.getByRole("button", { name: "View Thorin's sheet" }).click();
    await page.locator("iframe").waitFor();
    const sheetBox = (await page.locator('[role="dialog"]').boundingBox())!;
    await page.mouse.click(sheetBox.x + sheetBox.width / 2, sheetBox.y + sheetBox.height / 2);
    await page.waitForTimeout(200);
    expect(await page.locator("iframe").count()).toBe(1);

    // ...but a click on the dimmed page around it closes the sheet.
    await page.mouse.click(4, 4);
    await page.waitForTimeout(200);
    expect(await page.locator("iframe").count()).toBe(0);

    await page.close();
  }, 60_000);

  test("the sign-in page puts the cursor in the field still to be filled in", async () => {
    if (!browser) return;
    const page = await (await browser!.newContext()).newPage();

    /** The caption above whichever field holds the cursor. */
    const focused = () =>
      page.evaluate(
        () => document.activeElement?.closest("label")?.querySelector("span")?.textContent ?? "",
      );

    // Arriving cold, the code is what a player has to type first.
    await page.goto(base);
    await page.getByLabel("Session code").waitFor();
    expect(await focused()).toBe("Session code");

    // The game master's tab is a different form in the same place, so the
    // cursor has to move to it rather than stay where the player's was.
    await page.getByRole("tab", { name: "Game master" }).click();
    await page.getByLabel("Email").waitFor();
    expect(await focused()).toBe("Email");

    // Back to the player's tab, and back to the code.
    await page.getByRole("tab", { name: "Join a session" }).click();
    await page.getByLabel("Session code").waitFor();
    expect(await focused()).toBe("Session code");

    // A join link has already answered the code, so the name is what is left.
    await page.goto(`${base}/?code=ABCD-EFGH-JKMN`);
    await page.getByLabel("Player name").waitFor();
    expect(await focused()).toBe("Player name");

    await page.close();
  }, 60_000);
});
