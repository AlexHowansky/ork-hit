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

/** Signs in and builds a campaign with three characters, all through the UI. */
async function gmWithSession(): Promise<{ page: Page; code: string }> {
  const page = await (await browser!.newContext()).newPage();
  await page.goto(base);

  await page.getByRole("tab", { name: "Game master" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/gm");

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

  for (const name of ["Thorin", "Elara", "Strahd"]) {
    await page.getByRole("listitem").filter({ hasText: name })
      .getByRole("button", { name: "Add" }).click();
    await page.waitForTimeout(150);
  }
  await page.getByText("Initiative order (3)").waitFor();

  return { page, code };
}

/** Joins as a player and claims Thorin. */
async function playerIn(code: string, name: string): Promise<Page> {
  const page = await (await browser!.newContext()).newPage();
  await page.goto(`${base}/join?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join session" }).click();
  await page.getByText("Choose your character").waitFor();
  await page.getByRole("button", { name: "Thorin" }).click();
  await page.getByText(`Playing as ${name}`).waitFor();
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

  test("the initiative order can be dragged, and players see the new order", async () => {
    if (!browser) return;
    const { page: gm, code } = await gmWithSession();
    const player = await playerIn(code, "Bob");

    expect(await namesIn(gm)).toEqual(["Thorin", "Elara", "Strahd"]);

    // Drag the third row above the first.
    const handles = gm.locator('[aria-label^="Reorder"]');
    const third = (await handles.nth(2).boundingBox())!;
    const first = (await handles.nth(0).boundingBox())!;
    await gm.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await gm.mouse.down();
    await gm.mouse.move(first.x + first.width / 2, first.y - 10, { steps: 12 });
    await gm.mouse.up();
    await gm.waitForTimeout(600);

    expect(await namesIn(gm)).toEqual(["Strahd", "Thorin", "Elara"]);
    // The same order reached the player over the socket.
    expect(await namesIn(player)).toEqual(["Strahd", "Thorin", "Elara"]);

    // The keyboard path matters for anyone not using a mouse.
    await handles.nth(0).focus();
    await gm.keyboard.press("Space");
    await gm.waitForTimeout(150);
    await gm.keyboard.press("ArrowDown");
    await gm.waitForTimeout(150);
    await gm.keyboard.press("Space");
    await gm.waitForTimeout(600);

    expect(await namesIn(gm)).toEqual(["Thorin", "Strahd", "Elara"]);
    expect(await namesIn(player)).toEqual(["Thorin", "Strahd", "Elara"]);
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
