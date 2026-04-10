import type { Config } from "../config";
import type { CalendarEvent } from "../calendar/types";
import type { StatusResult } from "../status/resolver";
import { GoogleCalendarClient } from "../calendar/client";
import { SlackClient } from "../slack/client";
import { StateStore } from "../state/store";
import { resolveStatus } from "../status/resolver";

export class Scheduler {
  private eventCache: CalendarEvent[] = [];
  private lastFetchDate = 0;
  private currentDay = new Date().toDateString();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: Config,
    private calendarClient: GoogleCalendarClient,
    private slackClient: SlackClient,
    private stateStore: StateStore,
  ) {}

  async start(): Promise<void> {
    console.log("[scheduler] Starting…");
    await this.refreshEvents();
    await this.tick();

    const checkMs = this.config.schedule.check_interval_seconds * 1000;
    const refreshMs = this.config.schedule.calendar_refresh_interval_minutes * 60 * 1000;

    this.checkTimer = setInterval(() => void this.tick(), checkMs);
    this.refreshTimer = setInterval(() => void this.refreshEvents(), refreshMs);

    console.log(
      `[scheduler] Running — checking every ${this.config.schedule.check_interval_seconds}s, ` +
        `refreshing calendar every ${this.config.schedule.calendar_refresh_interval_minutes}m`,
    );
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async refreshEvents(): Promise<void> {
    const today = new Date().toDateString();

    // On day rollover, reset cache
    if (today !== this.currentDay) {
      console.log("[scheduler] New day detected — refreshing events");
      this.currentDay = today;
      this.eventCache = [];
    }

    try {
      this.eventCache = await this.calendarClient.fetchTodayEvents(
        this.config.google.calendar_ids,
        this.config.schedule.timezone,
        this.config.status.ooo_patterns,
        this.config.status.focus_patterns,
        this.config.status.lunch_patterns,
        this.config.status.skip_patterns,
      );
      this.lastFetchDate = Date.now();
      console.log(`[scheduler] Fetched ${this.eventCache.length} event(s) for today`);
    } catch (err) {
      console.error("[scheduler] Failed to fetch calendar events:", err);
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();

    // Day rollover check (handles cases where refresh timer hasn't fired yet)
    const today = now.toDateString();
    if (today !== this.currentDay) {
      await this.refreshEvents();
    }

    let newStatus: StatusResult | null = null;
    try {
      newStatus = resolveStatus(this.eventCache, this.config, now);
    } catch (err) {
      console.error("[scheduler] Error resolving status:", err);
      return;
    }

    if (!this.stateStore.hasStatusChanged(newStatus)) return;

    try {
      if (newStatus) {
        const label = newStatus.sourceEvent
          ? `"${newStatus.sourceEvent.title}"`
          : newStatus.eventType;
        console.log(`[scheduler] Setting status: ${newStatus.emoji} ${newStatus.text} (${label})`);
        await this.slackClient.setStatus(newStatus.emoji, newStatus.text, newStatus.sourceEvent?.end);
      } else {
        console.log("[scheduler] Clearing status (free)");
        await this.slackClient.clearStatus();
      }
      this.stateStore.saveStatus(newStatus);
    } catch (err) {
      console.error("[scheduler] Failed to update Slack status:", err);
    }
  }
}
