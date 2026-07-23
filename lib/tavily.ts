import { requireEnv } from "./env.js";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

// Free tier: 1,000 searches/month, no credit card required (verified July
// 2026). "basic" search_depth costs 1 credit/call vs 2 for "advanced" —
// basic is plenty for a single how-to-guide topic and keeps us well inside
// the free allowance even at daily use.
export async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: requireEnv("TAVILY_API_KEY"),
      query,
      search_depth: "basic",
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { results?: SearchResult[] };
  return data.results ?? [];
}
