import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

await mkdir(".wrangler/types", { recursive: true });
const environment = { ...process.env, WRANGLER_LOG_PATH: resolve(".wrangler/wrangler.log"), WRANGLER_SEND_METRICS: "false" };
// These commands operate only on the local DB/config and never need an account token.
delete environment.CLOUDFLARE_API_TOKEN;
delete environment.CLOUDFLARE_API_KEY;
const child = spawn(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), ...process.argv.slice(2)], { stdio: "inherit", env: environment });
child.on("error", () => { console.error("Wrangler is unavailable. Run npm ci first."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
