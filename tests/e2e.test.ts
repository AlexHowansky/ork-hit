/**
 * Browser tests for the behaviour that only exists in a real page: dragging the
 * initiative order, and player screens updating live without a refresh.
 *
 * These start their own server and drive a real Chromium, so they are slower than
 * the rest of the suite. They are skipped automatically when Playwright's browser
 * binaries aren't installed (`bunx playwright install chromium`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "playwright";
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
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Create campaign" }).click();
  // The panel of *this* campaign: an account with campaigns already has one on
  // screen, and it blinks out while the new campaign is being fetched.
  await page.getByText(`Characters in ${campaignName}`).waitFor();

  for (const [name, kind] of [["Thorin", "pc"], ["Elara", "pc"], ["Strahd", "npc"]] as const) {
    await page.getByRole("button", { name: "Add character" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Type").selectOption(kind);
    await page.getByLabel(/Character sheet/).setInputFiles({
      name: "sheet.html",
      mimeType: "text/html",
      buffer: Buffer.from(`<h1>${name}</h1><script>window.loaded = true;</script>`),
    });
    await page.getByRole("button", { name: "Add character" }).last().click();
    await page.getByRole("button", { name, exact: true }).waitFor();
  }

  await page.getByRole("button", { name: "Start session" }).click();
  await page.waitForURL("**/gm/sessions/**");
  const code = (await page.locator("code").first().innerText()).trim();

  // Starting a session brings the campaign's player characters in by itself, in
  // name order, so only the NPC is added by hand. The order is Elara, Thorin,
  // Strahd.
  await page.getByRole("listitem").filter({ hasText: "Strahd" })
    .getByRole("button", { name: "Add" }).click();
  await page.getByText("Initiative order (3)").waitFor();

  return { page, code, campaignName };
}

/** Joins as a player and claims Thorin. */
async function playerIn(code: string, name: string): Promise<Page> {
  const page = await (await browser!.newContext()).newPage();
  await page.goto(`${base}/join?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Player name").fill(name);
  await page.getByRole("button", { name: "Join session" }).click();
  await page.getByText("Choose your character").waitFor();
  await page.getByRole("button", { name: "Thorin" }).click();
  // The session page is headed by the player, and says which character they hold.
  await page.getByRole("heading", { name, exact: true }).waitFor();
  await page.getByText("Playing as Thorin").waitFor();
  // The players panel names the character each player holds, which is a different
  // id from the slot it sits in and was once matched against the wrong one.
  await page
    .locator("section", { hasText: /Players \(/ })
    .getByText("Playing Thorin")
    .waitFor();
  return page;
}

const namesIn = (page: Page) =>
  page
    .locator("section", { hasText: /Initiative order|In the scene/ })
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
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Alice");

    // The player appears on the console without either side reloading.
    await gm.getByText("Alice").first().waitFor({ timeout: 5000 });

    // Turn marker.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Set turn" }).click();
    await player.locator("p", { hasText: "Up now:" }).getByText("Strahd")
      .waitFor({ timeout: 5000 });

    // Walking off the end of the order advances the round on both screens.
    for (let i = 0; i < 3; i += 1) {
      await gm.getByRole("button", { name: "Next →" }).click();
      await gm.waitForTimeout(120);
    }
    await player.getByText("Round 2").waitFor({ timeout: 5000 });

    // Removing an NPC takes it off the player's list.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Remove" }).click();
    await player.getByText("In the scene (2)").waitFor({ timeout: 5000 });
  }, 60_000);

  test("an NPC can be brought on more than once, and each copy acts", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Gus");

    // Strahd is already on the stage once; two more makes three.
    const library = gm.locator("section", { hasText: "Add from library" });
    await library.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Add" }).click();
    await gm.getByText("Initiative order (4)").waitFor({ timeout: 5000 });
    await library.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Add" }).click();
    await gm.getByText("Initiative order (5)").waitFor({ timeout: 5000 });

    // The NPC stayed in the library — that is what lets it be added again — and
    // says how many of it are out.
    const strahdCard = library.getByRole("listitem").filter({ hasText: "Strahd" });
    expect(await strahdCard.count()).toBe(1);
    // The badge counts the copies already on the stage.
    expect((await strahdCard.innerText()).replace(/\s+/g, " ")).toContain("3");

    // Each copy is numbered, and the player sees the same numbers.
    const stage = gm.locator("section", { hasText: "Initiative order" });
    for (const n of ["1", "2", "3"]) {
      await stage.getByRole("listitem").filter({ hasText: `Strahd${n}` }).waitFor({ timeout: 5000 });
    }
    await player.getByText("In the scene (5)").waitFor({ timeout: 5000 });

    // A full round gives every copy its own turn rather than sticking on the first.
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await gm.getByRole("button", { name: "Next →" }).click();
      await gm.waitForTimeout(150);
      seen.push((await gm.locator("p", { hasText: "Up now:" }).innerText()).replace(/\s+/g, " "));
    }
    expect(seen.filter((line) => line.includes("Strahd"))).toHaveLength(3);
    expect(new Set(seen).size).toBe(5);

    // Removing the middle copy leaves the other two with the numbers they had.
    await stage.getByRole("listitem").filter({ hasText: "Strahd2" })
      .getByRole("button", { name: "Remove" }).click();
    await gm.getByText("Initiative order (4)").waitFor({ timeout: 5000 });
    await stage.getByRole("listitem").filter({ hasText: "Strahd1" }).waitFor({ timeout: 5000 });
    await stage.getByRole("listitem").filter({ hasText: "Strahd3" }).waitFor({ timeout: 5000 });
    expect(await stage.getByRole("listitem").filter({ hasText: "Strahd2" }).count()).toBe(0);
  }, 60_000);

  test("restarting takes both screens back to round 1", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Fran");

    // Into round 2, with a turn set, so there is something to go back from.
    for (let i = 0; i < 4; i += 1) {
      await gm.getByRole("button", { name: "Next →" }).click();
      await gm.waitForTimeout(120);
    }
    await player.getByText("Round 2").waitFor({ timeout: 5000 });

    // Restarting asks first, and backing out of the question changes nothing.
    await gm.getByRole("button", { name: "Restart" }).click();
    await gm.getByRole("dialog", { name: "Start over at round 1?" })
      .getByRole("button", { name: "Cancel" }).click();
    await gm.waitForTimeout(200);
    expect(await gm.getByText("Round 2").count()).toBe(1);

    await gm.getByRole("button", { name: "Restart" }).click();
    await gm.getByRole("dialog", { name: "Start over at round 1?" })
      .getByRole("button", { name: "Restart" }).click();

    // Round one, nobody up, and the player sees it without a refresh.
    await gm.getByText("No turn set yet").waitFor({ timeout: 5000 });
    await player.getByText("Round 1").waitFor({ timeout: 5000 });
    await player.getByText("No turn set yet").waitFor({ timeout: 5000 });

    // The stage is untouched: the same three are still in the scene.
    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);

    // And the next step opens round one at the top of the order.
    await gm.getByRole("button", { name: "Next →" }).click();
    await gm.locator("p", { hasText: "Up now:" }).getByText("Elara")
      .waitFor({ timeout: 5000 });
    expect(await gm.getByText("Round 1").count()).toBe(1);
  }, 60_000);

  test("the player whose turn it is gets told", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Dana");

    // Nobody is up yet, so nothing has been announced.
    expect(await player.getByText("It's your turn!").count()).toBe(0);

    // An NPC's turn is not this player's business.
    await gm.getByRole("listitem").filter({ hasText: "Strahd" })
      .getByRole("button", { name: "Set turn" }).click();
    await player.locator("p", { hasText: "Up now:" }).getByText("Strahd")
      .waitFor({ timeout: 5000 });
    expect(await player.getByText("It's your turn!").count()).toBe(0);

    // Their own character's turn is.
    await gm.getByRole("listitem").filter({ hasText: "Thorin" })
      .getByRole("button", { name: "Set turn" }).click();
    await player.getByText("It's your turn!").waitFor({ timeout: 5000 });
  }, 60_000);

  test("the initiative order can be dragged, and players see the new order", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Bob");

    expect(await namesIn(gm)).toEqual(["Elara", "Thorin", "Strahd"]);

    // Drag the third row above the first.
    const handles = gm.locator('[aria-label^="Reorder"]');
    const third = (await handles.nth(2).boundingBox())!;
    const first = (await handles.nth(0).boundingBox())!;
    await gm.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await gm.mouse.down();
    await gm.mouse.move(first.x + first.width / 2, first.y - 10, { steps: 12 });
    await gm.mouse.up();
    await gm.waitForTimeout(600);

    expect(await namesIn(gm)).toEqual(["Strahd", "Elara", "Thorin"]);
    // The same order reached the player over the socket.
    expect(await namesIn(player)).toEqual(["Strahd", "Elara", "Thorin"]);

    // The keyboard path matters for anyone not using a mouse.
    await handles.nth(0).focus();
    await gm.keyboard.press("Space");
    await gm.waitForTimeout(150);
    await gm.keyboard.press("ArrowDown");
    await gm.waitForTimeout(150);
    await gm.keyboard.press("Space");
    await gm.waitForTimeout(600);

    expect(await namesIn(gm)).toEqual(["Elara", "Strahd", "Thorin"]);
    expect(await namesIn(player)).toEqual(["Elara", "Strahd", "Thorin"]);
  }, 60_000);

  test("cards are drawn at the size the deployment asked for", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    // The picture is what the setting measures, so the picture is what is
    // measured here: the square image well of a card, in CSS pixels.
    // The select button fills the card's image well exactly, so its box is the
    // picture's box.
    const well = gm.getByRole("button", { name: `Select ${campaignName}` });
    const box = (await well.boundingBox())!;

    expect(Math.round(box.width)).toBe(config.cardImagePx);
    // Square, and the card around it is taller than its picture — the border and
    // the name below it are extra, as the setting's documentation promises.
    expect(Math.round(box.height)).toBe(config.cardImagePx);
    const card = (await well.locator("xpath=ancestor::article[1]").boundingBox())!;
    expect(card.height).toBeGreaterThan(box.height);
  }, 60_000);

  test("the character form asks for the sheet first", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();
    await gm.getByRole("button", { name: "Add character" }).click();

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
      "Background image (optional)",
    ]);
  }, 60_000);

  test("a sheet dropped on the character panel opens the form holding it", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    const campaignName = unique("Campaign");
    await gm.getByRole("button", { name: "New campaign" }).click();
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
    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    await gm.getByRole("button", { name: "Add character" }).click();
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
    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(campaignName);
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(`Characters in ${campaignName}`).waitFor();

    await gm.getByRole("button", { name: "Add character" }).click();
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
    await other.getByRole("button", { name: "New campaign" }).click();
    await other.getByLabel("Campaign name").fill(name);
    await other.getByRole("button", { name: "Create campaign" }).click();
    await other.getByText(`Characters in ${name}`).waitFor();

    const listed = watcher
      .locator("section", { hasText: "Sessions in progress" })
      .getByText(name);
    expect(await listed.count()).toBe(0);

    // The watching tab is never reloaded, and never touched at all.
    await other.getByRole("button", { name: "Start session" }).click();
    await other.waitForURL("**/gm/sessions/**");
    await listed.waitFor({ timeout: 5000 });

    await other.getByRole("button", { name: "End session" }).click();
    // The confirmation carries the same verb as the button that opened it, so
    // the second click is scoped to the dialog rather than the page.
    const ending = other.getByRole("dialog", { name: "End this session?" });
    await ending.getByRole("button", { name: "End session" }).click();
    await other.waitForURL("**/gm");
    await listed.waitFor({ state: "detached", timeout: 5000 });
  }, 60_000);

  test("a session can be ended from the library, without opening its console", async () => {
    if (!browser) return;
    const { page: gm, code, campaignName } = await gmWithSession();
    const player = await playerIn(code, "Hana");

    await gm.getByRole("button", { name: "← Library" }).click();
    await gm.waitForURL("**/gm");

    // Other tests of this same game master leave sessions running, so the row has
    // to be found by its own campaign rather than by being the only one.
    const row = gm.locator("li").filter({ hasText: campaignName });
    await row.getByRole("button", { name: "End session" }).click();

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

    await gm.getByRole("button", { name: "← Library" }).click();
    await gm.waitForURL("**/gm");

    const row = gm.locator("li").filter({ hasText: campaignName });
    await row.getByRole("button", { name: "End session" }).click();
    await gm.getByRole("dialog", { name: `End the session on “${campaignName}”?` })
      .getByRole("button", { name: "Cancel" }).click();

    await gm.waitForTimeout(300);
    expect(await row.getByRole("button", { name: "Open console" }).count()).toBe(1);
  }, 60_000);

  test("a player who closes their browser leaves the table", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Erin");

    await gm.getByText("Erin").first().waitFor({ timeout: 5000 });

    // No goodbye of any kind: the window simply goes, as it does when someone
    // shuts their laptop at the end of the evening.
    await player.context().close();

    // The game master's console empties the seat on its own, and Thorin — the
    // character Erin was holding — is free for someone else to take.
    await gm.getByText("Erin").first().waitFor({ state: "detached", timeout: 10_000 });
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
      await page.getByRole("button", { name: "New campaign" }).click();
      await page.getByLabel("Campaign name").fill(name);
      await page.getByRole("button", { name: "Create campaign" }).click();
      await page.getByText(`Characters in ${name}`).waitFor();
    }

    await page.getByRole("button", { name: `Select ${alpha}` }).click();
    await page.getByRole("button", { name: "Add character" }).click();
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
    await page.getByRole("button", { name: "New campaign" }).click();
    await page.getByLabel("Campaign name").fill(campaign);
    await page.getByRole("button", { name: "Create campaign" }).click();
    await page.getByText(`Characters in ${campaign}`).waitFor();

    await page.getByRole("button", { name: "Add character" }).click();
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
});
