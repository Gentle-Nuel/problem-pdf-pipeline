import type { VercelRequest } from "@vercel/node";

// Vercel Cron sends CRON_SECRET as an Authorization header automatically.
// The query-param fallback exists so a manual trigger from a phone browser
// (which can't set custom headers) still works without disabling auth
// entirely. Tradeoff: a secret in a URL can end up in browser history or
// server access logs, unlike a header — acceptable here since this only
// triggers a job and returns no sensitive data, but worth knowing it's there.
export function isAuthorizedCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — endpoint is open
  if (req.headers.authorization === `Bearer ${secret}`) return true;
  if (req.query.secret === secret) return true;
  return false;
}
