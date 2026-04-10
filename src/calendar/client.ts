import { google } from "googleapis"
import { OAuth2Client } from "google-auth-library"
import { readFileSync, writeFileSync, existsSync } from "fs"
import * as readline from "readline"
import type { CalendarEvent, EventType, RsvpStatus } from "./types"

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

interface Credentials {
  installed?: { client_id: string; client_secret: string; redirect_uris: string[] }
  web?: { client_id: string; client_secret: string; redirect_uris: string[] }
}

export class GoogleCalendarClient {
  private oauth2Client: OAuth2Client | null = null;

  constructor(
    private credentialsPath: string,
    private tokenPath: string,
  ) { }

  async authorize(): Promise<OAuth2Client> {
    if (this.oauth2Client) return this.oauth2Client

    const creds: Credentials = JSON.parse(readFileSync(this.credentialsPath, "utf-8"))
    const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web!
    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])

    if (existsSync(this.tokenPath)) {
      const token = JSON.parse(readFileSync(this.tokenPath, "utf-8"))
      client.setCredentials(token)
      // Refresh proactively if expiring within 5 minutes
      const expiry = token.expiry_date as number | undefined
      if (expiry && expiry - Date.now() < 5 * 60 * 1000) {
        const refreshed = await client.refreshAccessToken()
        client.setCredentials(refreshed.credentials)
        writeFileSync(this.tokenPath, JSON.stringify(refreshed.credentials, null, 2))
      }
    } else {
      throw new Error(
        `No token found at ${this.tokenPath}. Run with --setup to authenticate.`
      )
    }

    this.oauth2Client = client
    return client
  }

  async fetchTodayEvents(
    calendarIds: string[],
    timezone: string,
    oooPatterns: string[],
    focusPatterns: string[],
    lunchPatterns: string[],
    skipPatterns: string[],
  ): Promise<CalendarEvent[]> {
    const auth = await this.authorize()
    const calendar = google.calendar({ version: "v3", auth })

    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const allEvents: CalendarEvent[] = []

    for (const calendarId of calendarIds) {
      try {
        const res = await calendar.events.list({
          calendarId,
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          timeZone: timezone,
        })

        for (const item of res.data.items ?? []) {
          const title = item.summary ?? "(No title)"

          // Skip events matching skip patterns
          if (skipPatterns.some((p) => title.toLowerCase().includes(p.toLowerCase()))) {
            continue
          }

          const isAllDay = Boolean(item.start?.date && !item.start?.dateTime)
          const start = isAllDay
            ? new Date(item.start!.date! + "T00:00:00")
            : new Date(item.start!.dateTime!)
          const end = isAllDay
            ? new Date(item.end!.date! + "T00:00:00")
            : new Date(item.end!.dateTime!)

          // Determine RSVP status
          const selfAttendee = item.attendees?.find((a) => a.self)
          const rsvpStatus: RsvpStatus = selfAttendee
            ? (selfAttendee.responseStatus as RsvpStatus) ?? "needsAction"
            : "accepted" // organizer or sole attendee

          // Determine event type. "lunch" is synthetic (no Google native type), so check
          // it first — it can override any native type (e.g. an outOfOffice used for lunch).
          let eventType: EventType = "meeting"
          if (lunchPatterns.some((p) => title.toLowerCase().includes(p.toLowerCase()))) {
            eventType = "lunch"
          } else if (item.eventType === "outOfOffice" || oooPatterns.some((p) => title.toLowerCase().includes(p.toLowerCase()))) {
            eventType = "ooo"
          } else if (item.eventType === "focusTime" || focusPatterns.some((p) => title.toLowerCase().includes(p.toLowerCase()))) {
            eventType = "focus"
          }
          allEvents.push({ id: item.id!, title, start, end, isAllDay, eventType, rsvpStatus })
        }
      } catch (err) {
        console.error(`[calendar] Failed to fetch events for calendar "${calendarId}":`, err)
      }
    }

    // Sort: OOO first, then focus, then meetings, then by start time
    const priority: Record<EventType, number> = { ooo: 0, focus: 1, lunch: 2, meeting: 3 }
    allEvents.sort((a, b) => {
      if (priority[a.eventType] !== priority[b.eventType]) {
        return priority[a.eventType] - priority[b.eventType]
      }
      return a.start.getTime() - b.start.getTime()
    })

    return allEvents
  }

  static async runSetupFlow(credentialsPath: string, tokenPath: string): Promise<void> {
    const creds: Credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"))
    const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web!
    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0])

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    })

    console.log("\nOpen this URL in your browser to authorize:\n")
    console.log(authUrl)
    console.log("\nPaste the authorization code here:")

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const code = await new Promise<string>((resolve) => {
      rl.question("> ", (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })

    const { tokens } = await client.getToken(code)
    writeFileSync(tokenPath, JSON.stringify(tokens, null, 2))
    console.log(`\nToken saved to ${tokenPath}. You can now start the service.`)
  }
}
