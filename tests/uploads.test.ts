/**
 * Upload intake.
 *
 * Sheets deliberately keep their scripts — the isolation is applied when they are
 * served, not by rewriting them — so what matters here is that a file is checked
 * by its content, capped in size, and stored under a name that cannot be steered
 * by whoever uploaded it.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { storeImage, storeSheet } from "../src/server/uploads.ts";
import { limits } from "../src/lib/config.ts";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0]);

function file(name: string, contents: Uint8Array | string, type = ""): File {
  return new File([contents as BlobPart], name, { type });
}

describe("character sheets", () => {
  test("are stored intact, scripts and all", async () => {
    const html = "<html><body><script>alert(1)</script><h1>Hero</h1></body></html>";
    const upload = await storeSheet(file("hero.html", html));

    // Nothing is stripped: an interactive sheet has to keep working.
    expect(await Bun.file(upload.disk_path).text()).toBe(html);
    expect(upload.mime).toBe("text/html");
  });

  test("get a generated name on disk, never the uploaded one", async () => {
    const upload = await storeSheet(file("../../etc/passwd.html", "<p>x</p>"));

    // The uploaded name is kept only as metadata, and sanitised even there.
    expect(basename(upload.disk_path)).not.toContain("passwd");
    expect(upload.disk_path).not.toContain("..");
    expect(upload.original_name).not.toContain("/");
  });

  test("must actually be HTML by extension", async () => {
    await expect(storeSheet(file("sheet.exe", "<p>x</p>"))).rejects.toThrow(
      "Character sheets must be .html files.",
    );
    await expect(storeSheet(file("sheet.php", "<p>x</p>"))).rejects.toThrow(
      "Character sheets must be .html files.",
    );
    // .htm and .xhtml are legitimate.
    await expect(storeSheet(file("sheet.htm", "<p>x</p>"))).resolves.toBeDefined();
  });

  test("cannot be empty", async () => {
    await expect(storeSheet(file("sheet.html", ""))).rejects.toThrow("empty");
  });

  test("are capped in size", async () => {
    const tooBig = "x".repeat(limits.sheetBytes + 1);
    await expect(storeSheet(file("big.html", tooBig))).rejects.toThrow(/limit/i);
  });

  test("record a hash of what was stored", async () => {
    const upload = await storeSheet(file("sheet.html", "<p>same</p>"));
    const again = await storeSheet(file("other.html", "<p>same</p>"));
    // Identical content hashes identically, which makes duplicates identifiable.
    expect(upload.sha256).toBe(again.sha256);
    expect(upload.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("background images", () => {
  test("are identified by their magic bytes", async () => {
    expect((await storeImage(file("a.png", PNG))).mime).toBe("image/png");
    expect((await storeImage(file("b.gif", GIF))).mime).toBe("image/gif");
  });

  test("reject a file that merely claims to be an image", async () => {
    // An HTML payload with an image name and content type: exactly the trick
    // that turns an "image" upload into stored XSS when only the name is checked.
    const disguised = file("evil.png", "<script>alert(1)</script>", "image/png");
    await expect(storeImage(disguised)).rejects.toThrow(/PNG, JPEG, GIF or WebP/);
  });

  test("are capped in size", async () => {
    const big = new Uint8Array(limits.imageBytes + 1);
    big.set(PNG);
    await expect(storeImage(file("big.png", big))).rejects.toThrow(/limit|MB/i);
  });
});
