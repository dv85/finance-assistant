import test from "node:test";
import assert from "node:assert/strict";
import { localRequestAllowed } from "./localAccess.js";
const mode = { development: true, enabled: true };
const request = (extra = {}) => new Headers({ host: "127.0.0.1:4310", ...extra });

test("local mode accepts loopback and same-origin requests", () => {
  assert.equal(localRequestAllowed(request(), mode), true);
  assert.equal(localRequestAllowed(request({ "x-forwarded-host": "127.0.0.1:4310" }), mode), true);
  assert.equal(localRequestAllowed(request({ origin: "http://127.0.0.1:4310" }), mode), true);
});
test("production and disabled local mode always fail closed", () => {
  assert.equal(localRequestAllowed(request(), { ...mode, development: false }), false);
  assert.equal(localRequestAllowed(request(), { ...mode, enabled: false }), false);
});
test("remote hosts, forwarded headers, cross-site requests and mismatched origins are refused", () => {
  for (const headers of [
    { host: "example.invalid" }, { host: "localhost.evil.invalid:4310" }, { host: "user@localhost:4310" },
    { "x-forwarded-host": "localhost:4310" }, { "x-forwarded-for": "127.0.0.1" },
    { origin: "https://example.invalid" }, { origin: "null" }, { origin: "http://127.0.0.1:9999" },
    { "sec-fetch-site": "cross-site" }, { forwarded: "host=localhost" },
  ]) assert.equal(localRequestAllowed(request(headers), mode), false, JSON.stringify(headers));
});
test("identity-like headers cannot grant a remote request local access", () => {
  assert.equal(localRequestAllowed(request({ host: "example.invalid", "oai-authenticated-user-id": "example", "oai-authenticated-user-email": "example@example.invalid" }), mode), false);
});
