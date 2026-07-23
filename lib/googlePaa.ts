// Google's autocomplete endpoint is undocumented but has been stable and
// widely used for years. Same ToS caveat as the rest of this data source
// (see docs/spec.md "Guardrails" / Data sources) — scraping SERP-adjacent
// endpoints technically violates Google's ToS, enforcement is soft, this
// was already an accepted tradeoff for this specific low-effort
// validation layer, not a new risk being introduced here.
export async function fetchAutocompleteSuggestions(query: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Google autocomplete request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as [string, string[], ...unknown[]];
  return data[1] ?? [];
}
