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
async function gmWithSession(): Promise<{ page: Page; code: string }> {
  const page = await signedInGm();

  // A campaign and three characters, created through the dialogs.
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByLabel("Campaign name").fill(unique("Campaign"));
  await page.getByRole("button", { name: "Create campaign" }).click();
  await page.getByText(/^Characters in/).waitFor();

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

  return { page, code };
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
  return page;
}

const namesIn = (page: Page) =>
  page
    .locator("section", { hasText: /Initiative order|In the scene/ })
    .locator("li")
    .evaluateAll((rows) => rows.map((row) => row.querySelector("span.truncate")?.textContent ?? ""));

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

  test("the character form asks for the sheet first", async () => {
    if (!browser) return;
    const gm = await signedInGm();

    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(unique("Campaign"));
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(/^Characters in/).waitFor();
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

    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(unique("Campaign"));
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(/^Characters in/).waitFor();

    // A real drop on the panel itself, nowhere near the dialog — which is not
    // even open yet.
    const panel = gm.locator("section", { hasText: /^Characters in/ }).first();
    await panel.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["<h1>Gimli</h1>"], "Gimli son of Gloin.html", { type: "text/html" }),
      );
      element.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
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

    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(unique("Campaign"));
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(/^Characters in/).waitFor();

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

    await gm.getByRole("button", { name: "New campaign" }).click();
    await gm.getByLabel("Campaign name").fill(unique("Campaign"));
    await gm.getByRole("button", { name: "Create campaign" }).click();
    await gm.getByText(/^Characters in/).waitFor();

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
    await other.getByText(/^Characters in/).waitFor();

    const listed = watcher
      .locator("section", { hasText: "Sessions in progress" })
      .getByText(name);
    expect(await listed.count()).toBe(0);

    // The watching tab is never reloaded, and never touched at all.
    await other.getByRole("button", { name: "Start session" }).click();
    await other.waitForURL("**/gm/sessions/**");
    await listed.waitFor({ timeout: 5000 });

    other.on("dialog", (dialog) => void dialog.accept());
    await other.getByRole("button", { name: "End session" }).click();
    await other.waitForURL("**/gm");
    await listed.waitFor({ state: "detached", timeout: 5000 });
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
});
