import { defineStore } from "pinia";
import type { DeckSession } from "~~/shared/types";

interface State {
  sessions: DeckSession[];
  loading: boolean;
  error: string | null;
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
        const resp = await $fetch<{ sessions: DeckSession[] }>("/api/sessions");
        this.sessions = resp.sessions;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.loading = false;
      }
    },

    async remove(id: string) {
      try {
        await $fetch(`/api/sessions/${id}`, { method: "DELETE" });
        this.sessions = this.sessions.filter((s) => s.id !== id);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
    },
  },
});
