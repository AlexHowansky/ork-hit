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
import { collectOrphanedUploads, fileField, storeImage, storeSheet } from "../uploads.ts";
import type { CharacterRow, GmRow } from "../../db/types.ts";
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

      const imageFile = fileField(form, "background");
      const background = imageFile ? await storeImage(imageFile) : null;

      const character = characters.create({
        campaignId: input.campaignId,
        kind: input.kind,
        name: input.name,
        sheetUploadId: sheet.id,
        backgroundUploadId: background?.id ?? null,
      });
      logger.info("character created", { characterId: character.id, kind: character.kind });

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

        const rawKind = form.get("kind");
        if (rawKind === "pc" || rawKind === "npc") changes.kind = rawKind;

        const rawName = form.get("name");
        if (typeof rawName === "string") {
          const name = parse(schemas.displayName, rawName);
          const targetCampaign = changes.campaignId ?? character.campaign_id;
          if (characters.nameTaken(targetCampaign, name, character.id)) {
            throw errors.conflict(`This campaign already has a character called “${name}”.`);
          }
          changes.name = name;
        }

        const sheetFile = fileField(form, "sheet");
        if (sheetFile) changes.sheetUploadId = (await storeSheet(sheetFile)).id;

        const imageFile = fileField(form, "background");
        if (imageFile) {
          changes.backgroundUploadId = (await storeImage(imageFile)).id;
        } else if (form.get("removeBackground") === "true") {
          changes.backgroundUploadId = null;
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

        // Capture the affected sessions before the cascade removes the rows that
        // say which sessions those are.
        const notify = sessionIdsWith(character.id);

        characters.remove(character.id);
        await collectOrphanedUploads();
        logger.info("character deleted", { characterId: character.id });

        for (const sessionId of notify) broadcastSession(sessionId);
        return noContent();
      },
    ),
  },
};
