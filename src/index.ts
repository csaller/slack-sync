import { loadConfig } from "./config";
import { GoogleCalendarClient } from "./calendar/client";
import { SlackClient } from "./slack/client";
import { StateStore } from "./state/store";
import { Scheduler } from "./scheduler/scheduler";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const args = process.argv.slice(2);

function getFlag(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const configPath = getFlag("--config", "config.yaml");
const isSetup = args.includes("--setup");

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function runSetup(): Promise<void> {
  // For setup, we only need the google section — allow missing slack tokens
  let credentialsFile = "/data/credentials.json";
  let tokenFile = "/data/token.json";

  if (existsSync(configPath)) {
    try {
      const { loadConfig: lc } = await import("./config");
      // Parse partially — we only care about google paths
      const { parse } = await import("yaml");
      const { readFileSync } = await import("fs");
      const raw = readFileSync(configPath, "utf-8");
      const partial = parse(raw) as { google?: { credentials_file?: string; token_file?: string } };
      credentialsFile = partial?.google?.credentials_file ?? credentialsFile;
      tokenFile = partial?.google?.token_file ?? tokenFile;
    } catch {
      // Ignore parse errors during setup
    }
  }

  console.log(`[setup] Using credentials: ${credentialsFile}`);
  console.log(`[setup] Token will be saved to: ${tokenFile}`);

  if (!existsSync(credentialsFile)) {
    console.error(
      `\nError: credentials file not found at ${credentialsFile}\n` +
        "Download it from Google Cloud Console → APIs & Services → Credentials\n" +
        "and place it at the path above.",
    );
    process.exit(1);
  }

  ensureDir(tokenFile);
  await GoogleCalendarClient.runSetupFlow(credentialsFile, tokenFile);
}

async function runService(): Promise<void> {
  if (!existsSync(configPath)) {
    console.error(
      `Config file not found: ${configPath}\n` +
        "Copy config.example.yaml, fill in your tokens, and pass --config <path>.",
    );
    process.exit(1);
  }

  const config = loadConfig(configPath);

  const calendarClient = new GoogleCalendarClient(
    config.google.credentials_file,
    config.google.token_file,
  );
  const slackClient = new SlackClient(config.slack.xoxc_token, config.slack.xoxd_token);

  ensureDir(config.google.token_file);
  const stateStore = new StateStore(dirname(config.google.token_file) + "/state.json");

  const scheduler = new Scheduler(config, calendarClient, slackClient, stateStore);

  process.on("SIGINT", () => {
    console.log("\n[main] Shutting down…");
    scheduler.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("[main] SIGTERM received — shutting down…");
    scheduler.stop();
    process.exit(0);
  });

  await scheduler.start();
}

if (isSetup) {
  runSetup().catch((err) => {
    console.error("[setup] Fatal error:", err);
    process.exit(1);
  });
} else {
  runService().catch((err) => {
    console.error("[main] Fatal error:", err);
    process.exit(1);
  });
}
