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
import { portraitFromSheet, storeImage, storeSheet } from "../src/server/uploads.ts";
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

describe("the portrait inside a sheet", () => {
  /** A believable image: real magic bytes, padded to a believable size. */
  function image(signature: Uint8Array, bytes: number): Uint8Array {
    const data = new Uint8Array(bytes);
    data.set(signature);
    // Noise after the header, so two images of the same size are still distinct.
    for (let i = signature.length; i < bytes; i += 1) data[i] = (i * 7) % 251;
    return data;
  }

  const embed = (data: Uint8Array, mime = "image/png") =>
    `data:${mime};base64,${Buffer.from(data).toString("base64")}`;

  const sheetWith = async (body: string) => await storeSheet(file("sheet.html", body));

  test("is lifted out of a self-contained sheet", async () => {
    const portrait = image(PNG, 4096);
    const sheet = await sheetWith(
      `<h1>Hero</h1><img alt="portrait" src="${embed(portrait)}"><p>Strength 18</p>`,
    );

    const found = await portraitFromSheet(sheet);
    expect(found?.mime).toBe("image/png");
    expect(found?.kind).toBe("image");

    // Byte for byte what the sheet carried, not a re-encoding of it.
    const stored = new Uint8Array(await Bun.file(found!.disk_path).arrayBuffer());
    expect([...stored]).toEqual([...portrait]);
  });

  test("is the largest picture, whatever it is embedded in", async () => {
    const icon = image(PNG, 3000);
    const face = image(GIF, 9000);
    const sheet = await sheetWith(`
      <style>.d20 { background-image: url(${embed(icon)}); }</style>
      <img src="${embed(face, "image/gif")}">
    `);

    const found = await portraitFromSheet(sheet);
    expect(found?.mime).toBe("image/gif");
    expect((await Bun.file(found!.disk_path).arrayBuffer()).byteLength).toBe(9000);
  });

  test("is found where a script hid it, rather than only in a data URI", async () => {
    // What a real sheet does: the picture is a hex string in a variable, and the
    // `data:` URI is built at load time, so there is no `data:` in the file.
    const portrait = image(PNG, 6000);
    const hex = Buffer.from(portrait).toString("hex");
    const sheet = await sheetWith(`
      <img id="portrait-image" title="Redshift">
      <script>
        const imageName = 'redshift small.png';
        const imageHex = '${hex}';
        document.getElementById('portrait-image').src =
          'data:image/png;base64,' + btoa(fromHex(imageHex));
      </script>
    `);

    const found = await portraitFromSheet(sheet);
    expect(found?.mime).toBe("image/png");
    const stored = new Uint8Array(await Bun.file(found!.disk_path).arrayBuffer());
    expect([...stored]).toEqual([...portrait]);
  });

  test("is found where a script hid it as base64, without a data URI either", async () => {
    const portrait = image(GIF, 5000);
    const sheet = await sheetWith(
      `<script>const portrait = "${Buffer.from(portrait).toString("base64")}";</script>`,
    );

    const found = await portraitFromSheet(sheet);
    expect(found?.mime).toBe("image/gif");
  });

  test("is not a long string that merely looks like one", async () => {
    // A hash, a minified bundle, an embedded font: long runs of exactly these
    // characters are everywhere in a sheet, and none of them start like an image.
    const sheet = await sheetWith(`
      <script>const key = '${"deadbeef".repeat(2000)}';</script>
      <script>const blob = '${Buffer.from("x".repeat(9000)).toString("base64")}';</script>
    `);
    expect(await portraitFromSheet(sheet)).toBeNull();
  });

  test("is not a dice icon or a rules diagram", async () => {
    const sheet = await sheetWith(`<img src="${embed(image(PNG, 900))}">`);
    expect(await portraitFromSheet(sheet)).toBeNull();
  });

  test("is nothing at all when the sheet has no pictures", async () => {
    expect(await portraitFromSheet(await sheetWith("<h1>Hero</h1>"))).toBeNull();
  });

  test("is never fetched from a URL the sheet names", async () => {
    // Following this would let an uploaded file steer a request from the server,
    // which is the whole of SSRF. A linked picture is simply not taken.
    const sheet = await sheetWith(
      '<img src="http://169.254.169.254/latest/meta-data/"><img src="/portrait.png">',
    );
    expect(await portraitFromSheet(sheet)).toBeNull();
  });

  test("is checked by content, not by what the data URI claims", async () => {
    const lie = Buffer.from("<script>alert(1)</script>".repeat(200)).toString("base64");
    const sheet = await sheetWith(`<img src="data:image/png;base64,${lie}">`);
    expect(await portraitFromSheet(sheet)).toBeNull();
  });
});
