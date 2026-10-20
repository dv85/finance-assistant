import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig(async ({ command }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    define: { "process.env.FINANCE_LOCAL_MODE": JSON.stringify(command === "serve" && process.env.FINANCE_LOCAL_MODE === "true" ? "true" : "false") },
    server: {
      host: "127.0.0.1", port: 4310, strictPort: true, allowedHosts: ["localhost"],
      watch: process.env.CODEX_SANDBOX === "seatbelt" ? { useFsEvents: false, usePolling: true } : undefined,
    },
    plugins: [vinext(), cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: {
        main: "./worker/index.ts", compatibility_flags: ["nodejs_compat"],
        d1_databases: [{ binding: "DB", database_name: "finance-assistant-open-source-local", database_id: "00000000-0000-4000-8000-000000000001", migrations_dir: "drizzle" }],
        r2_buckets: [],
      },
    })],
  };
});
