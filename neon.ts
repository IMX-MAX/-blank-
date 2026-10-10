import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  preview: {
    buckets: {
      uploads: { access: "private" },
    },
  },
  // Added beyond the base config: the browser app needs a server to reach Postgres and the bucket.
  functions: {
    api: { name: "blank api", source: "api/src/index.ts" },
  },
});
