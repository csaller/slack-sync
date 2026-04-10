import { readFileSync, writeFileSync, existsSync } from "fs";
import type { StatusResult } from "../status/resolver";

interface PersistedState {
  lastEmoji: string | null;
  lastText: string | null;
}

export class StateStore {
  private state: PersistedState = { lastEmoji: null, lastText: null };

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.state = JSON.parse(readFileSync(filePath, "utf-8")) as PersistedState;
      } catch {
        // Corrupt state file — start fresh
        this.state = { lastEmoji: null, lastText: null };
      }
    }
  }

  hasStatusChanged(newStatus: StatusResult | null): boolean {
    const newEmoji = newStatus?.emoji ?? null;
    const newText = newStatus?.text ?? null;
    return this.state.lastEmoji !== newEmoji || this.state.lastText !== newText;
  }

  saveStatus(status: StatusResult | null): void {
    this.state = {
      lastEmoji: status?.emoji ?? null,
      lastText: status?.text ?? null,
    };
    try {
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.warn("[state] Failed to persist state:", err);
    }
  }
}
