export interface StackExchangeQuestion {
  question_id: number;
  title: string;
  body?: string;
  score: number;
  link: string;
  tags: string[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionText(q: StackExchangeQuestion): string {
  return `${q.title}\n\n${q.body ? stripHtml(q.body) : ""}`.trim();
}

// Public read endpoints need no auth. STACKEXCHANGE_KEY (from
// stackapps.com/apps/oauth/register) is optional but raises the shared
// per-IP quota from 300/day to 10,000/day — worth it once this runs on a
// schedule rather than ad hoc.
export async function fetchSiteQuestions(
  site: string,
  opts: { tag?: string; limit?: number; lookbackDays?: number } = {},
): Promise<StackExchangeQuestion[]> {
  const limit = opts.limit ?? 25;
  const lookbackDays = opts.lookbackDays ?? 180;
  const fromDate = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  const params = new URLSearchParams({
    site,
    order: "desc",
    sort: "votes",
    filter: "withbody",
    pagesize: String(limit),
    fromdate: String(fromDate),
  });
  if (opts.tag) params.set("tagged", opts.tag);
  if (process.env.STACKEXCHANGE_KEY) params.set("key", process.env.STACKEXCHANGE_KEY);

  const res = await fetch(`https://api.stackexchange.com/2.3/questions?${params}`);
  if (!res.ok) {
    throw new Error(`Stack Exchange fetch failed for ${site}: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { items: StackExchangeQuestion[] };
  return data.items;
}
