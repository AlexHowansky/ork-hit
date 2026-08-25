/**
 * Character library. Game master only.
 *
 * A character is a name plus an uploaded HTML sheet, filed under exactly one
 * campaign. The sheet itself is delivered by routes/files.ts.
 */

import type { BunRequest } from "bun";
import { handler, json, noContent, type RequestContext } from "../http.ts";
import { parse, schemas } from "../../lib/validate.ts";
import { errors } from "../../lib/errors.ts";
import { requireGm } from "../middleware/auth.ts";
import { campaigns, characters } from "../../db/queries.ts";
import { HERO_STAT_FIELDS, type HeroStatField } from "../../lib/hero.ts";
import {
  collectOrphanedUploads,
  fileField,
  portraitFromSheet,
  storeImage,
  storeSheet,
} from "../uploads.ts";
import type { CharacterRow, GmRow, UploadRow } from "../../db/types.ts";
import { presentCharacter } from "../presenters.ts";
import { sessionIdsWith } from "../session-state.ts";
import { broadcastSession } from "../ws.ts";

/** Loads a character and confirms it belongs to a campaign this GM owns. */
function requireOwnedCharacter(gm: GmRow, characterId: string): CharacterRow {
  const character = characters.byId(characterId);
  if (!character) throw errors.notFound("We couldn't find that character.");
  const campaign = campaigns.byId(character.campaign_id);
  if (!campaign || campaign.gm_id !== gm.id) {
    throw errors.notFound("We couldn't find that character.");
  }
  return character;
}

function requireOwnedCampaignId(gm: GmRow, campaignId: string): void {
  const campaign = campaigns.byId(campaignId);
  if (!campaign || campaign.gm_id !== gm.id) {
    throw errors.badRequest("Please choose one of your own campaigns for this character.");
  }
}

/**
 * The portrait embedded in a freshly uploaded sheet, if there is one.
 *
 * A picture the game master did not ask for is a convenience, never a reason to
 * fail: anything that goes wrong scanning the sheet leaves the character without
 * one, which is exactly where it would have been anyway.
 */
async function portraitOrNone(
  sheet: UploadRow,
  logger: RequestContext["logger"],
): Promise<UploadRow | null> {
  try {
    return await portraitFromSheet(sheet);
  } catch (error) {
    logger.warn("could not take a portrait from the sheet", { uploadId: sheet.id, error });
    return null;
  }
}

/**
 * The HERO characteristics a character form carries.
 *
 * A field the form left out is left out of the result, so a PATCH that never
 * mentions SPEED does not reset it; a field sent empty reads as zero, which is
 * what clearing the box means.
 */
function statsFromForm(form: FormData): Partial<Record<HeroStatField, number>> {
  const stats: Partial<Record<HeroStatField, number>> = {};
  for (const field of HERO_STAT_FIELDS) {
    const raw = form.get(field);
    if (typeof raw === "string") stats[field] = parse(schemas.heroStat, raw);
  }
  return stats;
}

export const characterRoutes = {
  "/api/characters": {
    GET: handler((request: BunRequest) => {
      const gm = requireGm(request);
      const campaignId = new URL(request.url).searchParams.get("campaignId") ?? undefined;
      return json({
        characters: characters.listForGm(gm.id, campaignId).map(presentCharacter),
      });
    }),

    POST: handler(async (request: BunRequest, { logger }: RequestContext) => {
      const gm = requireGm(request);
      const form = await request.formData();

      const input = parse(schemas.characterInput, {
        campaignId: form.get("campaignId"),
        kind: form.get("kind"),
        name: form.get("name"),
      });
      requireOwnedCampaignId(gm, input.campaignId);

      if (characters.nameTaken(input.campaignId, input.name)) {
        throw errors.conflict(`This campaign already has a character called “${input.name}”.`);
      }

      const sheetFile = fileField(form, "sheet");
      if (!sheetFile) throw errors.badRequest("Please choose an HTML character sheet to upload.");
      const sheet = await storeSheet(sheetFile);

      // An image the game master chose wins; otherwise the sheet may carry one.
      const imageFile = fileField(form, "background");
      const background = imageFile
        ? await storeImage(imageFile)
        : await portraitOrNone(sheet, logger);

      const character = characters.create({
        campaignId: input.campaignId,
        kind: input.kind,
        name: input.name,
        sheetUploadId: sheet.id,
        backgroundUploadId: background?.id ?? null,
        stats: statsFromForm(form),
      });
      logger.info("character created", {
        characterId: character.id,
        kind: character.kind,
        portraitFromSheet: !imageFile && background !== null,
      });

      return json({ character: presentCharacter(character) }, { status: 201 });
    }),
  },

  "/api/characters/:id": {
    PATCH: handler(
      async (request: BunRequest<"/api/characters/:id">, { logger }: RequestContext) => {
        const gm = requireGm(request);
        const character = requireOwnedCharacter(gm, request.params.id);
        const form = await request.formData();

        const changes: Parameters<typeof characters.update>[1] = {};

        const rawCampaign = form.get("campaignId");
        if (typeof rawCampaign === "string" && rawCampaign !== character.campaign_id) {
          requireOwnedCampaignId(gm, rawCampaign);
          changes.campaignId = rawCampaign;
        }

        // Refiling a character out of a campaign it is currently playing in would
        // leave it in that campaign's running session, which is neither what the
        // game master asked for nor something the players could make sense of.
        if (changes.campaignId && sessionIdsWith(character.id).length > 0) {
          throw errors.conflict(
            "This character is playing in a session that is still running. End that " +
              "session before moving them to another campaign.",
          );
        }

        const rawKind = form.get("kind");
        if (rawKind === "pc" || rawKind === "npc") changes.kind = rawKind;

        const rawName = form.get("name");
        if (typeof rawName === "string") changes.name = parse(schemas.displayName, rawName);

        for (const [field, value] of Object.entries(statsFromForm(form))) {
          changes[field as keyof ReturnType<typeof statsFromForm>] = value;
        }

        // Names are unique within a campaign, so the question is about the name and
        // the campaign this character is going to end up with — not about which of
        // the two the form happened to carry. A move alone can collide just as a
        // rename can, and a drop sends nothing but the campaign.
        if (changes.name !== undefined || changes.campaignId !== undefined) {
          const name = changes.name ?? character.name;
          const targetCampaign = changes.campaignId ?? character.campaign_id;
          if (characters.nameTaken(targetCampaign, name, character.id)) {
            throw errors.conflict(`This campaign already has a character called “${name}”.`);
          }
        }

        const sheetFile = fileField(form, "sheet");
        const sheet = sheetFile ? await storeSheet(sheetFile) : null;
        if (sheet) changes.sheetUploadId = sheet.id;

        const imageFile = fileField(form, "background");
        if (imageFile) {
          changes.backgroundUploadId = (await storeImage(imageFile)).id;
        } else if (form.get("removeBackground") === "true") {
          changes.backgroundUploadId = null;
        } else if (sheet && !character.background_upload_id) {
          // A new sheet fills an empty picture, and only an empty one: a portrait
          // found in a file must not displace the image a game master chose.
          const portrait = await portraitOrNone(sheet, logger);
          if (portrait) changes.backgroundUploadId = portrait.id;
        }

        const updated = characters.update(character.id, changes);
        if (changes.sheetUploadId || changes.backgroundUploadId !== undefined) {
          await collectOrphanedUploads();
        }
        logger.info("character updated", { characterId: character.id });

        // A rename or a new portrait changes what players are looking at, so any
        // session this character is active in needs to hear about it.
        for (const sessionId of sessionIdsWith(character.id)) broadcastSession(sessionId);

        return json({ character: presentCharacter(updated!) });
      },
    ),

    DELETE: handler(
      async (request: BunRequest<"/api/characters/:id">, { logger }: RequestContext) => {
        const gm = requireGm(request);
        const character = requireOwnedCharacter(gm, request.params.id);

        // Deleting would cascade through `session_characters` and take this
        // character off the stage of a running session mid-fight, with the players
        // watching them vanish and no way to put them back. The same rule as
        // refiling above, and for the same reason — with one more way out, since
        // taking them off the stage is enough where a move needs the whole session
        // ended.
        if (sessionIdsWith(character.id).length > 0) {
          throw errors.conflict(
            "This character is playing in a session that is still running. Take them " +
              "off the stage, or end that session, before deleting them.",
          );
        }

        characters.remove(character.id);
        await collectOrphanedUploads();
        logger.info("character deleted", { characterId: character.id });

        return noContent();
      },
    ),
  },
};
