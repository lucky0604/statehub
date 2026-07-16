import { todoService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/** Todos linked to a feature — for the Feature Detail checklist. */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const fid = param(params, "fid");
  return todoService.listForFeature(db(), wid, fid);
});
