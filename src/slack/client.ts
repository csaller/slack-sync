interface SlackProfilePayload {
  status_text: string;
  status_emoji: string;
  status_expiration: number;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

export class SlackClient {
  constructor(
    private xoxcToken: string,
    private xoxdToken: string,
  ) {}

  private async callApi(profile: SlackProfilePayload, attempt = 1): Promise<void> {
    const res = await fetch("https://slack.com/api/users.profile.set", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.xoxcToken}`,
        Cookie: `d=${this.xoxdToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ profile }),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "5");
      if (attempt <= 3) {
        console.warn(`[slack] Rate limited. Retrying in ${retryAfter}s (attempt ${attempt}/3)…`);
        await sleep(retryAfter * 1000);
        return this.callApi(profile, attempt + 1);
      }
      throw new Error("[slack] Rate limit exceeded after 3 retries");
    }

    const body = (await res.json()) as SlackApiResponse;
    if (!body.ok) {
      throw new Error(`[slack] API error: ${body.error}`);
    }
  }

  async setStatus(emoji: string, text: string, expirationDate?: Date): Promise<void> {
    const expiration = expirationDate ? Math.floor(expirationDate.getTime() / 1000) : 0;
    await this.callApi({ status_emoji: emoji, status_text: text, status_expiration: expiration });
  }

  async clearStatus(): Promise<void> {
    await this.callApi({ status_emoji: "", status_text: "", status_expiration: 0 });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
