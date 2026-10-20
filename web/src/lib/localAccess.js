/** Trust only a development server bound to loopback. No forwarded identity headers. */
export function localRequestAllowed(headers, { development, enabled }) {
  if (!development || !enabled) return false;
  const host = headers.get("host");
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.host !== host) return false;
    // Vinext adds x-forwarded-host for its internal loopback hop. Never use it
    // to establish identity; it may only repeat the direct Host exactly.
    const forwardedHost = headers.get("x-forwarded-host");
    if ((forwardedHost && forwardedHost !== host) || headers.get("x-forwarded-for") || headers.get("forwarded")) return false;
    if (headers.get("sec-fetch-site") === "cross-site") return false;
    const origin = headers.get("origin");
    if (origin && origin !== url.origin) return false;
    return true;
  } catch {
    return false;
  }
}
