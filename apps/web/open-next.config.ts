// open-next.config.ts — OpenNext Cloudflare adapter configuration.
// See https://opennext.js.org/cloudflare/get-started
//
// P08A: incremental cache disabled (no R2 bucket configured). All
// pages are force-dynamic anyway (see app/layout.tsx), so caching is
// moot. To enable R2 caching later, uncomment the import + field and
// provision an R2 bucket bound as `NEXT_INC_CACHE_R2_BUCKET`.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // For best results consider enabling R2 caching.
  // See https://opennext.js.org/cloudflare/caching for more details.
  // incrementalCache: r2IncrementalCache,
});
