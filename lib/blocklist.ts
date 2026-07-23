// Heuristic keyword filter for regulated-advice categories (health, legal,
// financial) — see docs/spec.md "Guardrails". Matches get skipped before
// they're ever clustered or turned into a paid guide. Deliberately simple
// and over-inclusive: false positives just mean a post gets skipped, false
// negatives are the real risk, so keep tuning this list as scrape runs turn
// up things it missed.

const BLOCKED_PATTERNS: RegExp[] = [
  // Health / medical
  /\b(diagnos(e|is|ed|ing)|symptoms?|prescri(be|ption)|dosage|is this cancer|chest pain|should i see a doctor|my doctor said|medical advice|mental health crisis|suicidal)\b/i,

  // Legal
  /\b(lawsuit|sue (my|the|him|her|them)|can my landlord|is (it|this) legal|legal advice|custody battle|divorce settlement|file a claim|criminal charges|immigration status)\b/i,

  // Financial
  /\b(should i invest|is this a scam|loan advice|tax advice|file for bankruptcy|financial advisor|retirement savings|investment strategy|crypto investment)\b/i,
];

export function isRegulatedAdvice(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}
