// Shared across every published surface (PDF, blog site). Applies
// regardless of topic — cheap insurance, no reason to make it
// conditional. Reworded (2026-07-24) after the site expanded past
// diy/cooking into gaming/outdoors/photo: the original phrasing asserted
// the guide itself involved "electrical, structural, plumbing... health,
// legal, or financial" work, which read oddly specific and mismatched on
// a genuinely benign topic (e.g. "how to check if film is loaded in the
// dark") — a small authenticity hit on exactly the "does this feel
// AI-templated" concern this pipeline cares about. Now phrased as a
// conditional ("if this applies") rather than an assertion that it does,
// so it fits every topic without needing per-cluster logic to select
// between variants.
export const DISCLAIMER =
  "This guide is for general informational purposes only and is not professional advice. If anything here touches safety-relevant work (electrical, structural, plumbing, or similar), or health, legal, or financial matters, always exercise appropriate caution and consult a qualified professional before acting.";
