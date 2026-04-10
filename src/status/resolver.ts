import type { CalendarEvent } from "../calendar/types";
import type { Config, StatusTemplate } from "../config";

export interface StatusResult {
  emoji: string;
  text: string;
  eventType: "ooo" | "focus" | "meeting" | "lunch" | "outside_hours" | "free";
  sourceEvent?: CalendarEvent;
}

function isOutsideWorkingHours(now: Date, start: string, end: string, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMins = hour * 60 + minute;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);

  return nowMins < sh * 60 + sm || nowMins >= eh * 60 + em;
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
  if (isOutsideWorkingHours(now, config.schedule.working_hours.start, config.schedule.working_hours.end, config.schedule.timezone)) {
    return {
      emoji: templates.outside_hours.emoji,
      text: templates.outside_hours.text,
      eventType: "outside_hours",
    };
  }

  // 6. Free during working hours → clear status
  return null;
}
