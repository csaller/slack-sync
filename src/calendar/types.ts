export type EventType = "ooo" | "focus" | "meeting" | "lunch";

export type RsvpStatus = "accepted" | "declined" | "tentative" | "needsAction";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  eventType: EventType;
  rsvpStatus: RsvpStatus;
}

export interface StatusResult {
  emoji: string;
  text: string;
  eventType: EventType | "outside_hours" | "free";
}
