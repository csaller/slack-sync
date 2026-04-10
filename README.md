# slack-sync

Automatically syncs your Google Calendar events to your Slack status. When you're in a meeting, focusing, out of office, or at lunch, your Slack status updates to reflect that — and clears when you're free.

## How it works

The service polls Google Calendar on a configurable interval, resolves the current event into a status, and calls the Slack API to update your profile. Status changes are persisted so the API is only called when something actually changes.

**Status priority:** OOO → Focus Time → Lunch → Meeting → Outside working hours → Clear

---

## Prerequisites

- [Bun](https://bun.sh) (for local runs) or [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/)
- A Google account with Google Calendar
- A Slack workspace where you want to update your status

---

## Step 1 — Google OAuth credentials

The service reads your calendar via the Google Calendar API using OAuth 2.0. You need to create a project and download credentials.

### 1.1 Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Give it any name (e.g. `slack-sync`) and click **Create**
4. Make sure the new project is selected in the dropdown

### 1.2 Enable the Google Calendar API

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for **Google Calendar API**
3. Click it and press **Enable**

### 1.3 Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** (unless you're in a Google Workspace org, in which case **Internal** is simpler)
3. Fill in the required fields:
   - **App name**: anything (e.g. `slack-sync`)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes** and search for `calendar.readonly`
   - Add: `https://www.googleapis.com/auth/calendar.readonly`
6. Click **Save and Continue**
7. On the **Test users** page, click **Add Users** and add your own Google account email
8. Click **Save and Continue** → **Back to Dashboard**

> **Note:** For personal use with only your own account, the app can stay in "Testing" mode indefinitely without needing verification.

### 1.4 Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Set **Application type** to **Desktop app**
4. Give it any name (e.g. `slack-sync-desktop`)
5. Click **Create**
6. In the dialog, click **Download JSON**
7. Save the file as `credentials.json` — you will place this in your data directory (see Step 3)

---

## Step 2 — Slack tokens

The service uses two browser-session tokens (`xoxc-` and `xoxd-`) to update your Slack status. These are your personal session credentials extracted from your browser.

> **Security note:** These tokens give full access to your Slack account. Never share them or commit them to version control.

### 2.1 Extract the tokens from your browser

1. Open Slack in your browser (e.g. `app.slack.com`) and sign in
2. Open your browser's Developer Tools:
   - Chrome/Edge: `F12` or `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac)
   - Firefox: `F12` or `Ctrl+Shift+I` / `Cmd+Option+I`
3. Go to the **Network** tab
4. In Slack, do any action that makes a network request (e.g. send a message, switch a channel)
5. In the Network tab, filter requests by `users.profile` or look for any POST to `slack.com/api/`
6. Click on one of the API requests
7. In the **Request Headers**, find:
   - **`Authorization`**: the value after `Bearer ` — this is your `xoxc-...` token
   - **`Cookie`**: find the `d=` portion — the value after `d=` (up to the next `;`) is your `xoxd-...` token

### Alternative: extract the cookie directly

1. In Developer Tools, go to **Application** (Chrome) or **Storage** (Firefox)
2. Expand **Cookies → https://app.slack.com**
3. Find the cookie named **`d`** — its value is the `xoxd-...` token
4. For the `xoxc-...` token, use the Network tab method above

### 2.2 Token format

- `xoxc_token`: starts with `xoxc-` (the Bearer token in Authorization header)
- `xoxd_token`: starts with `xoxd-` (the value of the `d` session cookie)

> **Token expiry:** These tokens are tied to your browser session. If you log out of Slack in the browser, you'll need to extract new tokens.

---

## Step 3 — Configuration

Copy the example config and fill in your values:

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:

```yaml
slack:
  xoxc_token: "xoxc-your-token-here"
  xoxd_token: "xoxd-your-token-here"

google:
  credentials_file: ".data/credentials.json"
  token_file: ".data/token.json"
  calendar_ids:
    - "primary"
    # Add more calendar IDs if needed, e.g.:
    # - "work@yourcompany.com"

schedule:
  check_interval_seconds: 60
  calendar_refresh_interval_minutes: 5
  timezone: "America/Sao_Paulo"   # IANA timezone name
  working_hours:
    start: "09:00"
    end: "18:00"

status:
  show_event_title: false   # true = use actual event title as Slack status text
  templates:
    meeting:
      emoji: ":calendar:"
      text: "In a meeting"
    focus:
      emoji: ":dart:"
      text: "Focus time"
    ooo:
      emoji: ":palm_tree:"
      text: "Out of office"
    lunch:
      emoji: ":knife_fork_plate:"
      text: "Out for lunch"
    outside_hours:
      emoji: ":no_entry_sign:"
      text: "Outside working hours"
```

Place your downloaded `credentials.json` in the data directory:

```bash
mkdir -p .data
cp ~/Downloads/credentials.json .data/credentials.json
```

---

## Step 4 — Google OAuth setup (first run only)

Before the service can run, you must complete the OAuth flow to generate a token. This is a one-time step.

### Local (Bun)

```bash
bun install
bun run setup
```

### Docker

```bash
docker compose run --rm slack-sync bun run dist/index.js --setup --config /app/config.yaml
```

The setup command will:
1. Print an authorization URL
2. Open a prompt asking for an authorization code

**What to do:**
1. Copy the URL and open it in your browser
2. Select the Google account you added as a test user
3. Grant the `calendar.readonly` permission
4. Google will display an authorization code — copy it
5. Paste the code into the terminal prompt and press Enter

A `token.json` file will be saved to `.data/token.json`. The service uses this file for all subsequent API calls and refreshes it automatically before it expires.

---

## Step 5 — Run the service

### Docker Compose (recommended for persistent runs)

```bash
docker compose up -d
```

View logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

### Local (Bun)

```bash
bun run start
```

With a custom config path:

```bash
bun run src/index.ts --config /path/to/config.yaml
```

---

## Configuration reference

| Key | Default | Description |
|-----|---------|-------------|
| `slack.xoxc_token` | *(required)* | Slack Bearer token (`xoxc-...`) |
| `slack.xoxd_token` | *(required)* | Slack session cookie (`xoxd-...`) |
| `google.credentials_file` | `/data/credentials.json` | Path to OAuth credentials JSON |
| `google.token_file` | `/data/token.json` | Path where OAuth token is stored |
| `google.calendar_ids` | `["primary"]` | List of calendar IDs to monitor |
| `schedule.check_interval_seconds` | `60` | How often to check if status needs updating |
| `schedule.calendar_refresh_interval_minutes` | `5` | How often to re-fetch events from Google |
| `schedule.timezone` | system timezone | IANA timezone (e.g. `America/New_York`) |
| `schedule.working_hours.start` | `09:00` | Start of working day (`HH:MM`) |
| `schedule.working_hours.end` | `18:00` | End of working day (`HH:MM`) |
| `status.show_event_title` | `false` | Use the event title as Slack status text |
| `status.templates.*` | see example | Emoji + text for each status type |
| `status.ooo_patterns` | `["OOO", "Out of Office", "Vacation"]` | Title substrings that trigger OOO status |
| `status.focus_patterns` | `["Focus Time", "Deep Work", "No Meetings"]` | Title substrings that trigger Focus status |
| `status.lunch_patterns` | `["Lunch", "Almoço", "Lunch break"]` | Title substrings that trigger Lunch status |
| `status.skip_patterns` | `[]` | Title substrings — matching events are ignored entirely |

### Finding your calendar ID

Your primary calendar ID is just `primary`. For other calendars:

1. Open [calendar.google.com](https://calendar.google.com)
2. In the left sidebar, hover over the calendar name → click the three-dot menu → **Settings and sharing**
3. Scroll to **Integrate calendar** — the **Calendar ID** is listed there (looks like an email address or `primary`)

---

## Data directory layout

```
.data/
  credentials.json   # Downloaded from Google Cloud Console (you provide this)
  token.json         # Generated by --setup (auto-created)
  state.json         # Last known status (auto-created, prevents redundant API calls)
```

---

## Troubleshooting

**`credentials file not found`**
Place `credentials.json` at the path specified in `google.credentials_file` in your config.

**`No token found … Run with --setup`**
You haven't completed the OAuth flow yet. Run the setup step (Step 4).

**`config: slack.xoxc_token is required`**
Your `config.yaml` is missing the Slack tokens. Re-check Step 2 and 3.

**`API error: invalid_auth`**
Your Slack tokens have expired (browser session was terminated). Re-extract them following Step 2.

**`Access blocked: This app's request is invalid`** (during Google OAuth)
You did not add your account as a test user on the OAuth consent screen. Go back to Step 1.3 and add your email under **Test users**.

**Status not updating**
Check `docker compose logs -f` for errors. Common causes: expired Slack tokens, Google token needing re-authorization, or no events on the calendar today.
