import { defineStore } from "pinia";
import { deleteDoc, loadDoc, saveDoc } from "~/utils/storage";
import type { DeckCard, DeckSession } from "~~/shared/types";

const NAMESPACE = "sessions";

interface State {
  sessions: DeckSession[];
  loading: boolean;
  error: string | null;
}

// Matches the server-side validator that used to guard session-file reads.
// Guards against hand-edited or legacy records that would crash the sort in
// `refresh()` below.
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

async function loadSessionIds(): Promise<string[]> {
  return (await loadDoc<string[]>(NAMESPACE, "index")) ?? [];
}

async function saveSessionIds(ids: string[]): Promise<void> {
  await saveDoc(NAMESPACE, "index", ids);
}

export const useSessionsStore = defineStore("sessions", {
  state: (): State => ({
    sessions: [],
    loading: false,
    error: null,
  }),

  actions: {
    async refresh() {
      this.loading = true;
      this.error = null;
      try {
        const ids = await loadSessionIds();
        const loaded: DeckSession[] = [];
        for (const id of ids) {
          const raw = await loadDoc<unknown>(NAMESPACE, id);
          if (isValidSession(raw)) loaded.push(raw);
        }
        loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        this.sessions = loaded;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },

    async upsert(session: DeckSession) {
      await saveDoc(NAMESPACE, session.id, session);
      const ids = await loadSessionIds();
      if (!ids.includes(session.id)) {
        ids.push(session.id);
        await saveSessionIds(ids);
      }
      const idx = this.sessions.findIndex((s) => s.id === session.id);
      const next = [...this.sessions];
      if (idx >= 0) next[idx] = session;
      else next.unshift(session);
      next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.sessions = next;
    },

    async remove(id: string) {
      try {
        await deleteDoc(NAMESPACE, id);
        const ids = (await loadSessionIds()).filter((x) => x !== id);
        await saveSessionIds(ids);
        this.sessions = this.sessions.filter((s) => s.id !== id);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
    },
  },
});
