import { promises as fs } from "node:fs";
import path from "node:path";
import type { DeckCard, DeckSession } from "~~/shared/types";

// Minimal shape validation — cheaper than a full schema lib and catches the
// "someone hand-edited the JSON and removed a field" case without crashing the
// sort that runs below.
function isValidSession(value: unknown): value is DeckSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.commanderName === "string" &&
    Array.isArray(s.colorIdentity) &&
    Array.isArray(s.cards) &&
    typeof s.createdAt === "string" &&
    typeof s.updatedAt === "string" &&
    (s.cards as DeckCard[]).every(
      (c) =>
        c &&
        typeof (c as { name?: unknown }).name === "string" &&
        typeof (c as { category?: unknown }).category === "string",
    )
  );
}

export default defineEventHandler(async () => {
  const { sessionsDir } = useRuntimeConfig();
  try {
    await fs.mkdir(sessionsDir, { recursive: true });
    const files = await fs.readdir(sessionsDir);
    const sessions: DeckSession[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(sessionsDir, file), "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (isValidSession(parsed)) sessions.push(parsed);
      } catch {
        // skip corrupt
      }
    }
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { sessions };
  } catch (_err) {
    return { sessions: [] };
  }
});
