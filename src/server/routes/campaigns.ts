/**
 * Campaign library. Game master only.
 */

import type { BunRequest } from "bun";
import { handler, json, noContent, type RequestContext } from "../http.ts";
import { parse, schemas } from "../../lib/validate.ts";
import { errors } from "../../lib/errors.ts";
import { requireGm, requireOwnedCampaign } from "../middleware/auth.ts";
import { campaigns } from "../../db/queries.ts";
import { collectOrphanedUploads, fileField, storeImage } from "../uploads.ts";
import { presentCampaign as present } from "../presenters.ts";

export const campaignRoutes = {
  "/api/campaigns": {
    GET: handler((request: BunRequest) => {
      const gm = requireGm(request);
      return json({ campaigns: campaigns.listForGm(gm.id).map(present) });
    }),

    POST: handler(async (request: BunRequest, { logger }: RequestContext) => {
      const gm = requireGm(request);
      const form = await request.formData();
      const { name } = parse(schemas.campaignInput, { name: form.get("name") });

      // Names are unique across the whole library, per the spec.
      if (campaigns.nameTaken(name)) {
        throw errors.conflict(`A campaign called “${name}” already exists.`);
      }

      const image = fileField(form, "background");
      const background = image ? await storeImage(image) : null;

      const campaign = campaigns.create({
        gmId: gm.id,
        name,
        backgroundUploadId: background?.id ?? null,
      });
      logger.info("campaign created", { gmId: gm.id, campaignId: campaign.id });

      return json({ campaign: present(campaign) }, { status: 201 });
    }),
  },

  "/api/campaigns/:id": {
    PATCH: handler(async (request: BunRequest<"/api/campaigns/:id">, { logger }: RequestContext) => {
      const { campaign } = requireOwnedCampaign(request, request.params.id);
      const form = await request.formData();

      const changes: { name?: string; backgroundUploadId?: string | null } = {};

      const rawName = form.get("name");
      if (typeof rawName === "string") {
        const { name } = parse(schemas.campaignInput, { name: rawName });
        if (name !== campaign.name && campaigns.nameTaken(name, campaign.id)) {
          throw errors.conflict(`A campaign called “${name}” already exists.`);
        }
        changes.name = name;
      }

      const image = fileField(form, "background");
      if (image) {
        changes.backgroundUploadId = (await storeImage(image)).id;
      } else if (form.get("removeBackground") === "true") {
        changes.backgroundUploadId = null;
      }

      const updated = campaigns.update(campaign.id, changes);
      // A replaced or removed background leaves its old file unreferenced.
      if (changes.backgroundUploadId !== undefined) await collectOrphanedUploads();
      logger.info("campaign updated", { campaignId: campaign.id });

      return json({ campaign: present(updated!) });
    }),

    DELETE: handler(
      async (request: BunRequest<"/api/campaigns/:id">, { logger }: RequestContext) => {
        const { campaign } = requireOwnedCampaign(request, request.params.id);
        // Characters and sessions cascade in the schema; their files are cleaned
        // up afterwards, once nothing references them.
        campaigns.remove(campaign.id);
        await collectOrphanedUploads();
        logger.info("campaign deleted", { campaignId: campaign.id });
        return noContent();
      },
    ),
  },
};
