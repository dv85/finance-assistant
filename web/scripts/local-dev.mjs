import { spawn } from "node:child_process";
import { resolve } from "node:path";
const child = spawn(process.execPath, [resolve("node_modules/vinext/dist/cli.js"), "dev"], {
  stdio: "inherit", env: { ...process.env, FINANCE_LOCAL_MODE: "true", WRANGLER_WRITE_LOGS: "false" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Could not launch Vinext. Run npm ci in web/ first."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
