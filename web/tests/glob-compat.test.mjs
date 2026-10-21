import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
// Resolve from the actual consumer: npm may keep the overridden package nested.
const glob = createRequire(require.resolve("vite-plugin-dynamic-import"))("fast-glob");

test("the dynamic-import glob replacement matches extensions, nesting and exclusions", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "finance-glob-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "nested"));
  for (const file of ["a.js", "b.ts", "c.txt", "nested/d.js"]) writeFileSync(join(cwd, file), "synthetic");
  const patterns = ["**/*.{js,ts}", "!b.ts"];
  assert.deepEqual(glob.sync(patterns, { cwd }).sort(), ["a.js", "nested/d.js"]);
  assert.deepEqual((await glob(patterns, { cwd })).sort(), ["a.js", "nested/d.js"]);
});

test("deep glob input is rejected before recursive parsing", () => {
  const nested = "{".repeat(5000) + "a,b" + "}".repeat(5000);
  assert.throws(() => glob.sync(nested), /nesting exceeds/);
  assert.throws(() => glob(nested), /nesting exceeds/);
  assert.throws(() => glob.sync("(}".repeat(5000)), /nesting exceeds/);
});
