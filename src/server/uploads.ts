/**
 * Upload intake.
 *
 * Two kinds of file arrive: character sheets (HTML) and background images.
 *
 * Sheets keep whatever JavaScript the game master authored — a sheet with dice
 * buttons or auto-calculating fields is expected to keep working — so they are
 * treated as untrusted code from this point on. Nothing here tries to sanitise
 * them; the isolation happens at delivery time in routes/files.ts, which drops
 * them into an opaque origin where they can't reach the app.
 *
 * What this module does guarantee: files land outside any statically served
 * directory, under a random name that never derives from user input, with a size
 * ceiling and a content type the app assigns rather than one the client claims.
 */

import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config, limits } from "../lib/config.ts";
import { errors } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { newId } from "../lib/ids.ts";
import { uploads } from "../db/queries.ts";
import type { UploadRow } from "../db/types.ts";

const SHEET_DIR = resolve(config.uploadDir, "sheets");
const IMAGE_DIR = resolve(config.uploadDir, "images");

await mkdir(SHEET_DIR, { recursive: true });
await mkdir(IMAGE_DIR, { recursive: true });

/** Magic-byte signatures, so an image is checked by content rather than by name. */
const IMAGE_SIGNATURES: ReadonlyArray<{ mime: string; test: (bytes: Uint8Array) => boolean }> = [
  {
    mime: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/gif",
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.test(bytes))?.mime ?? null;
}

/** Keeps a readable trace of what was uploaded without letting it influence a path. */
function safeOriginalName(name: string): string {
  return name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "upload";
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function persist(
  bytes: Uint8Array,
  directory: string,
  kind: "sheet" | "image",
  mime: string,
  originalName: string,
): Promise<UploadRow> {
  // The stored name is a fresh identifier; the uploaded filename never reaches
  // the filesystem, so there is no path to traverse out of.
  const diskName = newId();
  const diskPath = join(directory, diskName);
  await Bun.write(diskPath, bytes);

  const row = uploads.create({
    kind,
    diskPath,
    mime,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    originalName: safeOriginalName(originalName),
  });
  log.info("upload stored", { uploadId: row.id, kind, bytes: bytes.byteLength });
  return row;
}

async function readWithLimit(file: File, maxBytes: number, label: string): Promise<Uint8Array> {
  if (file.size > maxBytes) {
    throw errors.tooLarge(
      `That ${label} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        Math.round(maxBytes / 1024 / 1024)
      } MB.`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The declared size and the actual body can disagree; check what we really got.
  if (bytes.byteLength > maxBytes) {
    throw errors.tooLarge(`That ${label} is larger than the ${
      Math.round(maxBytes / 1024 / 1024)
    } MB limit.`);
  }
  return bytes;
}

/** Stores an uploaded character sheet. */
export async function storeSheet(file: File): Promise<UploadRow> {
  const name = file.name ?? "sheet.html";
  if (!/\.x?html?$/i.test(name)) {
    throw errors.badRequest("Character sheets must be .html files.");
  }
  const bytes = await readWithLimit(file, limits.sheetBytes, "character sheet");
  if (bytes.byteLength === 0) throw errors.badRequest("That character sheet file was empty.");
  return await persist(bytes, SHEET_DIR, "sheet", "text/html", name);
}

/** Stores a background image, verifying the format by its magic bytes. */
export async function storeImage(file: File): Promise<UploadRow> {
  const bytes = await readWithLimit(file, limits.imageBytes, "image");
  const mime = detectImageMime(bytes);
  if (!mime) {
    throw errors.badRequest("That image must be a PNG, JPEG, GIF or WebP file.");
  }
  return await persist(bytes, IMAGE_DIR, "image", mime, file.name ?? "image");
}

/* ---------------------------------------------------------------- portraits */

/** Images below this are furniture — dice icons, rules, logos — not a portrait. */
const MIN_PORTRAIT_BYTES = 2 * 1024;

/** Bounds the work a sheet full of long encoded strings can ask for. */
const MAX_CANDIDATES = 50;

/** Enough of the front of a candidate to recognise an image by, in characters. */
const PREFIX_CHARS = 32;

/**
 * The two ways an image is found sitting inside an HTML file.
 *
 * Base64 covers the ordinary case: a browser saving a page writes the picture
 * into the markup as a `data:` URI, and the payload of one is simply a long
 * base64 run. Hex covers sheets whose generator hides the picture in a script
 * variable and assembles the `data:` URI at load time — the image is just as
 * embedded, but there is no `data:` prefix in the file to look for.
 *
 * Neither pattern looks for any surrounding syntax, because there is no agreeing
 * on it: the same picture turns up in an `img` tag, in a CSS `url()`, and in a
 * string a script later assigns to `.src`. What identifies an image here is what
 * identifies every other upload — the bytes it starts with.
 */
const ENCODINGS = [
  {
    // Four characters carry three bytes.
    pattern: new RegExp(`[A-Za-z0-9+/]{${Math.ceil((MIN_PORTRAIT_BYTES * 4) / 3)},}={0,2}`, "g"),
    size: (run: string) => (run.length / 4) * 3,
    decode: (run: string) => Uint8Array.from(atob(run), (character) => character.charCodeAt(0)),
  },
  {
    // Two characters carry one byte.
    pattern: new RegExp(`[0-9a-fA-F]{${MIN_PORTRAIT_BYTES * 2},}`, "g"),
    size: (run: string) => run.length / 2,
    decode: (run: string) => {
      // An odd trailing character would be half a byte; drop it rather than
      // letting the decoder guess.
      const even = run.length % 2 === 0 ? run : run.slice(0, -1);
      return new Uint8Array(Buffer.from(even, "hex"));
    },
  },
] as const;

/**
 * The portrait embedded in a character sheet, if it has one.
 *
 * Sheets are usually saved as a single self-contained file, so the character's
 * picture is already inside the HTML — as a `data:` URI, or as a hex or base64
 * string a script turns into one. Taking it saves the game master finding and
 * uploading the same image a second time.
 *
 * The biggest embedded image wins. There is no markup convention for "this one
 * is the portrait" — the attributes vary by whoever authored the sheet — but a
 * portrait is reliably larger than the icons and rules diagrams around it, and
 * anything too small to be one is skipped outright.
 *
 * Only what is embedded is considered. A sheet that links a picture by URL is
 * left alone on purpose: fetching it would have the server make a request to
 * wherever an uploaded file says to, which is how an upload form becomes a way
 * to reach things only the server can see. A relative `src` has nothing to
 * resolve against in the first place, since a sheet is stored as one file.
 */
export async function portraitFromSheet(sheet: UploadRow): Promise<UploadRow | null> {
  let html: string;
  try {
    html = await Bun.file(sheet.disk_path).text();
  } catch (error) {
    log.warn("could not re-read sheet to look for a portrait", { uploadId: sheet.id, error });
    return null;
  }

  let best: { bytes: Uint8Array; mime: string } | null = null;

  for (const encoding of ENCODINGS) {
    let seen = 0;

    for (const match of html.matchAll(encoding.pattern)) {
      if (seen >= MAX_CANDIDATES) break;
      seen += 1;

      const run = match[0];
      const size = encoding.size(run);

      // Both ends first, on the length alone: nothing is decoded to find out
      // that it is a thumbnail, or larger than an upload may be. With today's
      // limits a sheet cannot hold one that large — encoding costs at least a
      // third again — but the two ceilings are separate knobs, so this does not
      // assume they stay in step.
      if (size < MIN_PORTRAIT_BYTES || size > limits.imageBytes) continue;
      // Nor is anything decoded that cannot beat what we already have.
      if (best && size <= best.bytes.byteLength) continue;

      // Most long runs in a sheet are minified script, a hash, or an embedded
      // font. Decoding the first few bytes settles what this one is before
      // megabytes of it are decoded.
      let bytes: Uint8Array;
      try {
        if (!detectImageMime(encoding.decode(run.slice(0, PREFIX_CHARS)))) continue;
        bytes = encoding.decode(run);
      } catch {
        continue; // Not the encoding it looked like.
      }

      const mime = detectImageMime(bytes);
      if (!mime || bytes.byteLength < MIN_PORTRAIT_BYTES) continue;
      if (best && bytes.byteLength <= best.bytes.byteLength) continue;

      best = { bytes, mime };
    }
  }

  if (!best) return null;

  const extension = best.mime.replace("image/", "").replace("jpeg", "jpg");
  log.info("portrait taken from a sheet", {
    uploadId: sheet.id,
    mime: best.mime,
    bytes: best.bytes.byteLength,
  });
  return await persist(best.bytes, IMAGE_DIR, "image", best.mime, `portrait.${extension}`);
}

/** Removes an upload's row and its file. Missing files are not an error. */
export async function deleteUpload(uploadId: string): Promise<void> {
  const row = uploads.byId(uploadId);
  if (!row) return;
  uploads.remove(row.id);
  try {
    await unlink(row.disk_path);
  } catch (error) {
    log.warn("could not delete upload file", { uploadId: row.id, error });
  }
}

/**
 * Deletes every upload nothing references any more. Called after a character or
 * campaign is removed, so deleted sheets don't linger on disk.
 */
export async function collectOrphanedUploads(): Promise<number> {
  const orphans = uploads.orphaned();
  for (const orphan of orphans) await deleteUpload(orphan.id);
  if (orphans.length > 0) log.info("collected orphaned uploads", { count: orphans.length });
  return orphans.length;
}

/**
 * Pulls a single optional file field out of a multipart form, rejecting empty
 * placeholder parts that browsers send for untouched file inputs.
 */
export function fileField(form: FormData, name: string): File | null {
  const value = form.get(name);
  if (!(value instanceof File)) return null;
  if (value.size === 0) return null;
  return value;
}
