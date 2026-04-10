import type { CalendarEvent } from "../calendar/types";
import type { Config, StatusTemplate, WorkingHours } from "../config";

export interface StatusResult {
  emoji: string;
  text: string;
  eventType: "ooo" | "focus" | "meeting" | "lunch" | "outside_hours" | "free";
  sourceEvent?: CalendarEvent;
}

function getMinutesOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function getDayOfWeek(date: Date, timezone: string): number {
  // Returns 0 (Sun) … 6 (Sat)
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// Returns a Date representing the given hour:minute on the same calendar day
// as `reference`, expressed in `timezone`, converted to UTC.
function dateAtTime(reference: Date, hour: number, minute: number, timezone: string): Date {
  const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(reference);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  // Treat the target local time as UTC to get a probe, then correct for the offset.
  const probe = new Date(`${localDate}T${hh}:${mm}:00Z`);
  const probeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const probeHour = Number(probeParts.find((p) => p.type === "hour")?.value ?? 0);
  const probeMins = Number(probeParts.find((p) => p.type === "minute")?.value ?? 0);
  const diffMs = ((probeHour * 60 + probeMins) - (hour * 60 + minute)) * 60_000;
  return new Date(probe.getTime() - diffMs);
}

function isOutsideWorkingHours(now: Date, wh: WorkingHours, timezone: string): boolean {
  if (!wh.days.includes(getDayOfWeek(now, timezone))) return true;
  const nowMins = getMinutesOfDay(now, timezone);
  const [sh, sm] = wh.start.split(":").map(Number);
  const [eh, em] = wh.end.split(":").map(Number);
  return nowMins < sh * 60 + sm || nowMins >= eh * 60 + em;
}

// Returns the Date when the current working period ends (if inside hours) or
// when the next working period begins (if outside hours / on a non-work day).
// Use this as the Slack status expiration so statuses auto-expire even if the
// scheduler goes down.
export function nextWorkBoundary(now: Date, wh: WorkingHours, timezone: string): Date {
  const [sh, sm] = wh.start.split(":").map(Number);
  const [eh, em] = wh.end.split(":").map(Number);

  if (!isOutsideWorkingHours(now, wh, timezone)) {
    // Currently inside working hours → expire at end of today's shift
    return dateAtTime(now, eh, em, timezone);
  }

  // Outside hours → find the next workday and return its start time
  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    if (wh.days.includes(getDayOfWeek(candidate, timezone))) {
      return dateAtTime(candidate, sh, sm, timezone);
    }
  }

  // Fallback — should never be reached with a valid config
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function buildText(template: StatusTemplate, event: CalendarEvent | undefined, showTitle: boolean): string {
  if (showTitle && event && !event.isAllDay) {
    return event.title;
  }
  return template.text;
}

export function resolveStatus(
  events: CalendarEvent[],
  config: Config,
  now: Date,
): StatusResult | null {
  const templates = config.status.templates;
  const showTitle = config.status.show_event_title;

  // 1. OOO: all-day or timed events with OOO type active now
  const oooEvent = events.find(
    (e) =>
      e.eventType === "ooo" &&
      e.rsvpStatus !== "declined" &&
      (e.isAllDay || (e.start <= now && e.end > now)),
  );
  if (oooEvent) {
    return {
      emoji: templates.ooo.emoji,
      text: buildText(templates.ooo, oooEvent, showTitle),
      eventType: "ooo",
      sourceEvent: oooEvent,
    };
  }

  // 2. Focus time: active right now
  const focusEvent = events.find(
    (e) =>
      e.eventType === "focus" &&
      e.rsvpStatus !== "declined" &&
      !e.isAllDay &&
      e.start <= now &&
      e.end > now,
  );
  if (focusEvent) {
    return {
      emoji: templates.focus.emoji,
      text: buildText(templates.focus, focusEvent, showTitle),
      eventType: "focus",
      sourceEvent: focusEvent,
    };
  }

  // 3. Lunch break: active right now
  const lunchEvent = events.find(
    (e) =>
      e.eventType === "lunch" &&
      e.rsvpStatus !== "declined" &&
      !e.isAllDay &&
      e.start <= now &&
      e.end > now,
  );
  if (lunchEvent) {
    return {
      emoji: templates.lunch.emoji,
      text: buildText(templates.lunch, lunchEvent, showTitle),
      eventType: "lunch",
      sourceEvent: lunchEvent,
    };
  }

  // 4. Active meeting: non-declined, not all-day, happening now
  // If multiple, pick the one that started most recently
  const activeNow = events.filter(
    (e) =>
      e.eventType === "meeting" &&
      e.rsvpStatus !== "declined" &&
      !e.isAllDay &&
      e.start <= now &&
      e.end > now,
  );
  if (activeNow.length > 0) {
    activeNow.sort((a, b) => b.start.getTime() - a.start.getTime());
    const meeting = activeNow[0];
    return {
      emoji: templates.meeting.emoji,
      text: buildText(templates.meeting, meeting, showTitle),
      eventType: "meeting",
      sourceEvent: meeting,
    };
  }

  // 5. Outside working hours
  if (isOutsideWorkingHours(now, config.schedule.working_hours, config.schedule.timezone)) {
    return {
      emoji: templates.outside_hours.emoji,
      text: templates.outside_hours.text,
      eventType: "outside_hours",
    };
  }

  // 6. Free during working hours → clear status
  return null;
}
