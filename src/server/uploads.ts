/**
 * Upload intake.
 *
 * Two kinds of file arrive: character sheets (HTML) and card images.
 *
 * Sheets keep whatever JavaScript the game master authored — a sheet with dice
 * buttons or auto-calculating fields is expected to keep working — so they are
 * treated as untrusted code from this point on. Nothing here tries to sanitise
 * them; the isolation happens at delivery time in routes/files.ts, which drops
 * them into an opaque origin where they can't reach the app. The one edit a sheet
 * ever receives is `removeRun`, which takes back out the portrait that has just
 * become the character's card rather than storing that picture twice.
 *
 * What this module does guarantee: files land outside any statically served
 * directory, under a random name that never derives from user input, with a size
 * ceiling and a content type the app assigns rather than one the client claims.
 */

import { mkdir, readdir, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import sharp from "sharp";
import { config, limits } from "../lib/config.ts";
import { errors } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { newId } from "../lib/ids.ts";
import { uploads } from "../db/queries.ts";
import type { UploadRow } from "../db/types.ts";

const SHEET_DIR = resolve(config.uploadDir, "sheets");
const IMAGE_DIR = resolve(config.uploadDir, "images");

/**
 * Where an upload's file actually is.
 *
 * `disk_path` is stored relative to the upload directory, so the rows survive
 * the checkout being renamed or moved — an absolute path written at upload time
 * froze the directory name of the day into every row, and a rename orphaned the
 * lot. Rows written before that changed hold an absolute path and are passed
 * through untouched.
 */
export function uploadPath(row: Pick<UploadRow, "disk_path">): string {
  return isAbsolute(row.disk_path) ? row.disk_path : resolve(config.uploadDir, row.disk_path);
}

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
  // The file is named after the row that is about to describe it, and the
  // uploaded filename never reaches the filesystem, so there is no path to
  // traverse out of. The two used to be separate identifiers — one minted here
  // and one inside `uploads.create` — which read as the same id typo'd whenever
  // they turned up side by side in a log, and left a file whose row had gone
  // (a restore from an older database, say) with nothing to identify it. Reading
  // an upload still goes through `disk_path` rather than rebuilding the path
  // from the id, so files can be rehomed and rows written before this change
  // keep working untouched. What the row stores is relative to the upload
  // directory: an absolute path would name whatever directory the checkout sat
  // in the day the file arrived, and moving it would orphan every upload.
  const id = newId();
  const diskPath = join(directory, id);
  await Bun.write(diskPath, bytes);

  const row = uploads.create({
    id,
    kind,
    diskPath: join(kind === "image" ? "images" : "sheets", id),
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

/**
 * Holds a submission carrying more than one file to the same ceiling the files
 * are held to individually.
 *
 * `UPLOAD_LIMIT_BYTES` is documented to an operator as the size of an upload, and
 * the only route that takes two files at once is a character's — a sheet and a
 * picture, in one submission. Without this, that request could carry twice the
 * configured limit, and a reverse proxy sized to the setting would cut it off
 * with a generic error of its own instead of the message below.
 *
 * Sizes come from the parsed multipart body, so they are the bytes that actually
 * arrived rather than anything the client asserted; each file is still measured
 * on its own as it is read.
 */
export function requireTotalWithinLimit(...files: (File | null)[]): void {
  const total = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
  if (total > limits.uploadBytes) {
    throw errors.tooLarge(
      `Those files are ${(total / 1024 / 1024).toFixed(1)} MB together. The limit is ${
        Math.round(limits.uploadBytes / 1024 / 1024)
      } MB.`,
    );
  }
}

/** Stores an uploaded character sheet. */
export async function storeSheet(file: File): Promise<UploadRow> {
  const name = file.name ?? "sheet.html";
  if (!/\.x?html?$/i.test(name)) {
    throw errors.badRequest("Character sheets must be .html files.");
  }
  const bytes = await readWithLimit(file, limits.uploadBytes, "character sheet");
  if (bytes.byteLength === 0) throw errors.badRequest("That character sheet file was empty.");
  return await persist(bytes, SHEET_DIR, "sheet", "text/html", name);
}

/**
 * How hard the WebP encoder is asked to work.
 *
 * 80 is the knee of the curve for pictures at this size: visually indistinct
 * from the source inside a 176px card, and roughly half the bytes of 90. Higher
 * settings mostly buy detail the card crops away.
 */
const WEBP_QUALITY = 80;

/**
 * Scales a picture down to the size it is actually looked at, and stores it in
 * the format that holds it in the fewest bytes.
 *
 * Every image the app shows ends up in a square card 176px across, so a 4000px
 * photograph costs a game master's phone several megabytes to draw a thumbnail.
 * The shorter side is what has to cover that square, so that is what is scaled —
 * to `limits.storedImagePx`, proportionally, with nothing cropped: the card takes
 * its square at display time, and the rest of the picture is still there for
 * anywhere it is shown differently. Nothing is enlarged.
 *
 * Then the same picture is encoded as WebP and the two are weighed against each
 * other, because the format a picture arrives in is rarely the one it should be
 * kept in: a photograph saved as PNG is lossless data about a lossy subject, and
 * over the images this app has been given WebP came out about seven times
 * smaller. The winner is whichever buffer is actually smaller, which is the whole
 * rule — re-encoding an already-lossy JPEG can *grow* it, and when it does the
 * original stands. Alpha survives the conversion, and an animated GIF converts
 * whole rather than flattening to its first frame.
 *
 * What the format never decides is what is *accepted*: that is still the
 * magic-byte check in `detectImageMime`, on the bytes as they arrived.
 *
 * A picture that cannot be read is stored as it came in. It passed the magic-byte
 * check, so this is a decoder disagreeing about the details of a real image, and
 * a game master would rather have their picture at full size than an error.
 */
async function fitToCard(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const animated = mime === "image/gif";
  const asUploaded = { bytes, mime };
  try {
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height) return asUploaded;

    // The picture at the size it will be looked at, still in its own format.
    // This is the candidate WebP has to beat, and on an image already small
    // enough it is simply the bytes that arrived.
    const scaled = Math.min(width, height) > limits.storedImagePx
      ? new Uint8Array(
        await sharp(bytes, { animated })
          .resize({
            width: limits.storedImagePx,
            height: limits.storedImagePx,
            // `outside` fits the shorter side to the box and lets the longer one
            // run over, which is exactly what a cropping card needs.
            fit: "outside",
            withoutEnlargement: true,
          })
          .toBuffer(),
      )
      : bytes;

    const webp = new Uint8Array(
      await sharp(scaled, { animated }).webp({ quality: WEBP_QUALITY }).toBuffer(),
    );

    const best = webp.byteLength < scaled.byteLength
      ? { bytes: webp, mime: "image/webp" }
      : { bytes: scaled, mime };

    if (best.bytes !== bytes) {
      log.info("image fitted to the card", {
        from: `${width}x${height} ${mime} ${bytes.byteLength}B`,
        to: `${best.mime} ${best.bytes.byteLength}B`,
      });
    }
    return best;
  } catch (error) {
    log.warn("could not fit an image; storing it as uploaded", { mime, error });
    return asUploaded;
  }
}

/**
 * Stores an image, verifying the format by its magic bytes and scaling it to the
 * size it is displayed at. Returns null for anything that is not an image.
 */
async function persistImage(bytes: Uint8Array, originalName: string): Promise<UploadRow | null> {
  const mime = detectImageMime(bytes);
  if (!mime) return null;
  // What is stored, and the type it is served as, is what came back from the fit
  // — which may be WebP whatever arrived.
  const fitted = await fitToCard(bytes, mime);
  return await persist(fitted.bytes, IMAGE_DIR, "image", fitted.mime, originalName);
}

/** Stores a card image, verifying the format by its magic bytes. */
export async function storeImage(file: File): Promise<UploadRow> {
  const bytes = await readWithLimit(file, limits.uploadBytes, "image");
  const stored = await persistImage(bytes, file.name ?? "image");
  if (!stored) {
    throw errors.badRequest("That image must be a PNG, JPEG, GIF or WebP file.");
  }
  return stored;
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
    html = await Bun.file(uploadPath(sheet)).text();
  } catch (error) {
    log.warn("could not re-read sheet to look for a portrait", { uploadId: sheet.id, error });
    return null;
  }

  let best: { bytes: Uint8Array; mime: string; run: string } | null = null;

  for (const encoding of ENCODINGS) {
    let seen = 0;

    for (const match of html.matchAll(encoding.pattern)) {
      if (seen >= MAX_CANDIDATES) break;
      seen += 1;

      const run = match[0];
      const size = encoding.size(run);

      // Both ends first, on the length alone: nothing is decoded to find out
      // that it is a thumbnail, or larger than an upload may be. A sheet cannot
      // in fact hold one that large — it is held to the same ceiling, and
      // encoding costs at least a third again — but the check is cheap and says
      // plainly what the range of interest is.
      if (size < MIN_PORTRAIT_BYTES || size > limits.uploadBytes) continue;
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

      best = { bytes, mime, run };
    }
  }

  if (!best) return null;

  const extension = best.mime.replace("image/", "").replace("jpeg", "jpg");
  log.info("portrait taken from a sheet", {
    uploadId: sheet.id,
    mime: best.mime,
    bytes: best.bytes.byteLength,
  });
  // Scaled on the way in like any other picture: a sheet's portrait is often the
  // largest image the app ever sees.
  const portrait = await persistImage(best.bytes, `portrait.${extension}`);
  if (portrait) await removeRun(sheet, best.run);
  return portrait;
}

/**
 * Takes the portrait's own bytes back out of the sheet that carried it.
 *
 * Once the picture is a card of its own, the copy inside the HTML is the same
 * image stored twice — and it is the larger copy, since a card is fitted on the
 * way in while a sheet carries whatever was pasted into it. It is also the bulk
 * of what a sheet weighs: the sheets in one library ran to 18 MB, almost all of
 * it embedded portraits, and one 985 KB sheet came out at 52 KB.
 *
 * Only the run that was decoded goes, and it is replaced with nothing rather
 * than with a stand-in. This module never looks at the syntax around a run —
 * that is what lets it find a picture in an `img` tag, a CSS `url()` and a
 * script variable alike — so what is left behind is an empty `data:` URI in the
 * first case and an empty string literal in the last. Both are still the
 * document the game master wrote, minus one picture; neither is markup this had
 * to understand to produce.
 *
 * Which means a sheet that drew its own portrait no longer draws one. That is
 * the trade this makes: the picture is on the card, which is where the app shows
 * it, and the sheet is the sheet rather than a second copy of the image.
 *
 * Every copy of the run goes, since a sheet that pasted its portrait twice is
 * carrying it twice. A sheet that cannot be rewritten is left exactly as it was
 * and the portrait still stands: the picture is the point, and what the sheet
 * saves is the bonus.
 */
async function removeRun(sheet: UploadRow, run: string): Promise<void> {
  try {
    const html = await Bun.file(uploadPath(sheet)).text();
    const trimmed = html.replaceAll(run, "");
    if (trimmed === html) return;

    const bytes = new TextEncoder().encode(trimmed);
    await Bun.write(uploadPath(sheet), bytes);
    // The row describes the file, so what the file now weighs and hashes to has
    // to travel with it — `db:gc` and the duplicate check both read those.
    uploads.rewrite(sheet.id, { byteSize: bytes.byteLength, sha256: sha256(bytes) });
    log.info("portrait removed from the sheet that carried it", {
      uploadId: sheet.id,
      bytes: `${html.length} -> ${bytes.byteLength}`,
    });
  } catch (error) {
    log.warn("could not take the portrait out of the sheet", { uploadId: sheet.id, error });
  }
}

/** Removes an upload's row and its file. Missing files are not an error. */
export async function deleteUpload(uploadId: string): Promise<void> {
  const row = uploads.byId(uploadId);
  if (!row) return;
  uploads.remove(row.id);
  try {
    await unlink(uploadPath(row));
  } catch (error) {
    // A file that has already gone is the ordinary case when a sweep catches up
    // with rows left behind by something else, so it is not worth a warning. A
    // file that is there and will not delete is: that one needs a person.
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const report = missing ? log.debug : log.warn;
    report("could not delete upload file", { uploadId: row.id, error });
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
 * Files under the upload directories that no `uploads` row claims.
 *
 * The mirror image of `uploads.orphaned()`, which finds rows nothing references:
 * this finds files nothing describes. They come from a write that landed before
 * its row failed to, and from a database restored from a backup older than the
 * files beside it. Nothing swept for them before `db:gc`.
 *
 * The scan lives here because `SHEET_DIR` and `IMAGE_DIR` do — where the files
 * are kept is this module's business and nobody else's.
 */
export async function findStrayFiles(): Promise<string[]> {
  const claimed = new Set(uploads.all().map(uploadPath));
  const stray: string[] = [];
  for (const directory of [SHEET_DIR, IMAGE_DIR]) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if (!claimed.has(path)) stray.push(path);
    }
  }
  return stray;
}

/** Deletes what `findStrayFiles` finds. Returns how many went. */
export async function collectStrayFiles(): Promise<number> {
  const stray = await findStrayFiles();
  for (const path of stray) {
    try {
      await unlink(path);
    } catch (error) {
      log.warn("could not delete stray upload file", { path, error });
    }
  }
  if (stray.length > 0) log.info("collected stray upload files", { count: stray.length });
  return stray.length;
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
