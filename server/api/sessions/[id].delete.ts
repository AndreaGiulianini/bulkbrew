import { promises as fs } from "node:fs";
import path from "node:path";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, message: "Missing id" });
  const { sessionsDir } = useRuntimeConfig();
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const file = path.join(sessionsDir, `${safeId}.json`);
  try {
    await fs.unlink(file);
  } catch {
    // already gone
  }
  return { ok: true };
});
