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
