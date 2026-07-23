import { requireEnv } from "./env.js";

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  ups: number;
  permalink: string;
  stickied: boolean;
}

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");
  const userAgent = requireEnv("REDDIT_USER_AGENT");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Reddit auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// Read-only, app-only OAuth (client_credentials) — no Reddit user account
// needed, sufficient for pulling public posts.
export async function fetchSubredditPosts(
  subreddit: string,
  opts: { query?: string; limit?: number } = {},
): Promise<RedditPost[]> {
  const [token, userAgent] = await Promise.all([
    getAccessToken(),
    Promise.resolve(requireEnv("REDDIT_USER_AGENT")),
  ]);
  const limit = opts.limit ?? 25;

  const url = opts.query
    ? `https://oauth.reddit.com/r/${subreddit}/search?q=${encodeURIComponent(opts.query)}&restrict_sr=1&sort=top&t=month&limit=${limit}`
    : `https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent,
    },
  });

  if (!res.ok) {
    throw new Error(`Reddit fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { data: { children: { data: RedditPost }[] } };
  return data.data.children.map((child) => child.data);
}
