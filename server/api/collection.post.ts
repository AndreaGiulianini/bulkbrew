import { promises as fs } from "node:fs";
import path from "node:path";

// Largest collection we'll accept. ManaBox CSVs for a ~10k-card collection
// are well under 2 MB; anything beyond 10 MB is almost certainly an accident
// (wrong file) or an abuse vector.
const MAX_CSV_BYTES = 10 * 1024 * 1024;

export default defineEventHandler(
  async (event): Promise<{ ok: true; path: string; bytes: number }> => {
    const { collectionPath } = useRuntimeConfig();
    const body = await readBody<{ csv?: string; filename?: string }>(event);
    const csv = body?.csv;
    if (typeof csv !== "string" || !csv.trim()) {
      throw createError({ statusCode: 400, statusMessage: "Missing csv content" });
    }

    const bytes = Buffer.byteLength(csv, "utf8");
    if (bytes > MAX_CSV_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: `Collection CSV too large (${bytes} bytes; limit ${MAX_CSV_BYTES}).`,
      });
    }

    const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
    if (!/name/i.test(firstLine) || !/scryfall\s*id/i.test(firstLine)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          "CSV does not look like a ManaBox export (missing Name or Scryfall ID header)",
      });
    }

    await fs.mkdir(path.dirname(collectionPath), { recursive: true });
    await fs.writeFile(collectionPath, csv, "utf8");

    return { ok: true, path: collectionPath, bytes };
  },
);
