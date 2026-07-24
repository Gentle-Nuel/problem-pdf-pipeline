import type { APIRoute } from "astro";

// Generated rather than a static public/robots.txt so the Sitemap: line
// always reflects the real PUBLIC_SITE_URL instead of a hardcoded value
// someone has to remember to update. This is also the file most likely to
// silently leave a site un-indexed if it's ever wrong — explicit allow,
// explicit sitemap reference, no ambiguity.
export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = new URL("sitemap-index.xml", site).toString();
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`, {
    headers: { "Content-Type": "text/plain" },
  });
};
