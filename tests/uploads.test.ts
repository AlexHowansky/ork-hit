/**
 * Upload intake.
 *
 * Sheets deliberately keep their scripts — the isolation is applied when they are
 * served, not by rewriting them — so what matters here is that a file is checked
 * by its content, capped in size, and stored under a name that cannot be steered
 * by whoever uploaded it.
 */

import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import {
  collectStrayFiles,
  deleteUpload,
  findStrayFiles,
  portraitFromSheet,
  storeImage,
  storeSheet,
} from "../src/server/uploads.ts";
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

  test("are named on disk after the row that describes them", async () => {
    const upload = await storeSheet(file("hero.html", "<p>x</p>"));

    // One identifier, not two: a stray file names its own row, and a log line
    // carrying both cannot read as the same id mistyped.
    expect(basename(upload.disk_path)).toBe(upload.id);
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

describe("card images", () => {
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

describe("images are stored at the size they are looked at", () => {
  /** A real picture, not a header with noise behind it: this one gets decoded. */
  const picture = async (width: number, height: number, format: "png" | "gif" = "png") => {
    const image = sharp({
      create: { width, height, channels: 3, background: { r: 160, g: 40, b: 60 } },
    });
    return new Uint8Array(await (format === "gif" ? image.gif() : image.png()).toBuffer());
  };

  const sizeOf = async (path: string) => {
    const { width, height, format } = await sharp(await Bun.file(path).arrayBuffer()).metadata();
    return { width, height, format };
  };

  test("a picture larger than a card is scaled down to it", async () => {
    const upload = await storeImage(file("big.png", await picture(2000, 1500)));

    // The shorter side is what has to cover the card, so that is what is fitted.
    expect(await sizeOf(upload.disk_path)).toEqual({
      width: Math.round((2000 / 1500) * limits.storedImagePx),
      height: limits.storedImagePx,
      format: "png",
    });
  });

  test("the shape of the picture is never changed", async () => {
    const tall = await storeImage(file("tall.png", await picture(900, 2700)));
    const { width, height } = await sizeOf(tall.disk_path);

    expect(width).toBe(limits.storedImagePx);
    expect(height! / width!).toBeCloseTo(2700 / 900, 1);
  });

  test("nothing is cropped away", async () => {
    // A panorama keeps its panorama-ness: the card crops at display time, and the
    // rest of the picture is still in the file.
    const wide = await storeImage(file("wide.png", await picture(4000, 800)));
    const { width, height } = await sizeOf(wide.disk_path);

    expect(height).toBe(limits.storedImagePx);
    expect(width).toBe(Math.round(4000 * (limits.storedImagePx / 800)));
  });

  test("a picture already small enough is left exactly as it arrived", async () => {
    const original = await picture(300, 200);
    const upload = await storeImage(file("small.png", original));

    // Not enlarged, and not re-encoded either.
    const stored = new Uint8Array(await Bun.file(upload.disk_path).arrayBuffer());
    expect([...stored]).toEqual([...original]);
  });

  test("an animated GIF stays a GIF", async () => {
    const upload = await storeImage(file("moving.gif", await picture(1600, 1200, "gif")));

    expect(upload.mime).toBe("image/gif");
    expect(await sizeOf(upload.disk_path)).toMatchObject({
      height: limits.storedImagePx,
      format: "gif",
    });
  });

  test("a portrait taken out of a sheet is scaled like any other picture", async () => {
    const portrait = await picture(1800, 1200);
    const sheet = await storeSheet(
      file("hero.html", `<img src="data:image/png;base64,${Buffer.from(portrait).toString("base64")}">`),
    );

    const found = await portraitFromSheet(sheet);
    expect(await sizeOf(found!.disk_path)).toMatchObject({ height: limits.storedImagePx });
  });
});

describe("housekeeping", () => {
  test("finds and deletes files no row claims, and leaves claimed ones alone", async () => {
    const kept = await storeSheet(file("kept.html", "<p>keep me</p>"));
    // A file written straight into the upload directory, as an interrupted
    // upload or an older database would leave behind.
    const stray = join(dirname(kept.disk_path), "stray-file");
    await Bun.write(stray, "<p>nobody's</p>");

    expect(await findStrayFiles()).toContain(stray);
    expect(await findStrayFiles()).not.toContain(kept.disk_path);

    await collectStrayFiles();

    expect(await Bun.file(stray).exists()).toBe(false);
    expect(await Bun.file(kept.disk_path).exists()).toBe(true);
  });

  test("deleting an upload whose file has already gone is not an error", async () => {
    const upload = await storeSheet(file("gone.html", "<p>x</p>"));
    await unlink(upload.disk_path);

    await expect(deleteUpload(upload.id)).resolves.toBeUndefined();
  });
});
