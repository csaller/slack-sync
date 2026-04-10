import { readFileSync } from "fs";
import { parse } from "yaml";

export interface StatusTemplate {
  emoji: string;
  text: string;
}

export interface WorkingHours {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface Config {
  slack: {
    xoxc_token: string;
    xoxd_token: string;
  };
  google: {
    credentials_file: string;
    token_file: string;
    calendar_ids: string[];
  };
  schedule: {
    check_interval_seconds: number;
    calendar_refresh_interval_minutes: number;
    timezone: string;
    working_hours: WorkingHours;
  };
  status: {
    show_event_title: boolean;
    templates: {
      meeting: StatusTemplate;
      focus: StatusTemplate;
      ooo: StatusTemplate;
      outside_hours: StatusTemplate;
      lunch: StatusTemplate;
    };
    ooo_patterns: string[];
    focus_patterns: string[];
    lunch_patterns: string[];
    skip_patterns: string[];
  };
}

const DEFAULTS: Config = {
  slack: { xoxc_token: "", xoxd_token: "" },
  google: {
    credentials_file: "/data/credentials.json",
    token_file: "/data/token.json",
    calendar_ids: ["primary"],
  },
  schedule: {
    check_interval_seconds: 60,
    calendar_refresh_interval_minutes: 5,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    working_hours: { start: "09:00", end: "18:00" },
  },
  status: {
    show_event_title: false,
    templates: {
      meeting: { emoji: ":calendar:", text: "In a meeting" },
      focus: { emoji: ":dart:", text: "Focus time" },
      ooo: { emoji: ":palm_tree:", text: "Out of office" },
      outside_hours: { emoji: ":no_entry_sign:", text: "Outside working hours" },
      lunch: { emoji: ":fork_and_knife:", text: "Out for lunch" },
    },
    ooo_patterns: ["OOO", "Out of Office", "Vacation"],
    focus_patterns: ["Focus Time", "Deep Work", "No Meetings"],
    lunch_patterns: ["Lunch", "Almoço", "Lunch Break"],
    skip_patterns: [],
  },
};

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (typeof val === "object" && !Array.isArray(val) && typeof base[key] === "object") {
        result[key] = deepMerge(base[key], val as Partial<T[keyof T]>);
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw) as Partial<Config>;
  const config = deepMerge(DEFAULTS, parsed);

  if (!config.slack.xoxc_token) throw new Error("config: slack.xoxc_token is required");
  if (!config.slack.xoxd_token) throw new Error("config: slack.xoxd_token is required");

  return config;
}
