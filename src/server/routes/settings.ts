/**
 * A game master's own settings.
 *
 * What is here is about the person rather than about the table: how big they
 * want cards drawn, and whatever else joins it later. It hangs off the `gms` row
 * so that it follows them to whichever machine they sign in on — the theme,
 * which is about the room they are sitting in rather than about them, stays in
 * the browser instead (`client/theme.ts`).
 *
 * There is no GET. The one caller is the console at boot, and it already asks
 * who it is talking to — `/api/auth/me` carries the settings back with the
 * identity, which saves a second round trip before the first card is drawn.
 */

import type { BunRequest } from "bun";
import { handler, json, type RequestContext } from "../http.ts";
import { parseJsonBody, schemas } from "../../lib/validate.ts";
import { requireGm } from "../middleware/auth.ts";
import { gms } from "../../db/queries.ts";
import { presentGm } from "../presenters.ts";

export const settingsRoutes = {
  "/api/settings": {
    PATCH: handler(async (request: BunRequest, { logger }: RequestContext) => {
      const gm = requireGm(request);
      const changes = await parseJsonBody(request, schemas.gmSettings);

      gms.update(gm.id, changes);
      logger.info("gm settings changed", { gmId: gm.id, fields: Object.keys(changes) });

      // What was actually saved, read back rather than echoed: a field the
      // schema dropped should not come home looking as though it had been kept.
      // The identity's own shape, so a caller comparing the two is comparing
      // like with like.
      return json({ settings: presentGm(gms.byId(gm.id)!) });
    }),
  },
};
