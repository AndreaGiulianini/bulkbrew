import { promises as fs } from "node:fs";
import path from "node:path";
import type { DeckSession } from "~~/shared/types";

export default defineEventHandler(async (event) => {
  const body = await readBody<DeckSession>(event);
  if (!body?.id) throw createError({ statusCode: 400, message: "Missing id" });
  const { sessionsDir } = useRuntimeConfig();
  await fs.mkdir(sessionsDir, { recursive: true });
  const safeId = body.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const file = path.join(sessionsDir, `${safeId}.json`);
  body.updatedAt = new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(body, null, 2), "utf8");
  return { ok: true, session: body };
});
