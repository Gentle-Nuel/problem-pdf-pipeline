import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// `site` must be the real production URL for sitemap.xml and canonical
// tags to generate correct absolute URLs — set PUBLIC_SITE_URL in this
// project's own Vercel env vars (not the main pipeline's) once you know
// the deployed URL. Falls back to a placeholder so a first build without
// it set still succeeds rather than failing outright — but the sitemap
// and canonical tags will be wrong until it's set for real, so don't skip
// this step. See README step 8b.
const site = process.env.PUBLIC_SITE_URL || "https://example.vercel.app";

export default defineConfig({
  site,
  integrations: [sitemap()],
});
