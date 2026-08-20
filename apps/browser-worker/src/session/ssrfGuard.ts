import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { BadRequestException } from "@nestjs/common";

/**
 * Best-effort SSRF guard for `session.service.ts`'s two routes (`/session/run`, `/session/live`).
 *
 * Unlike `render.service.ts`'s existing `/render` (a one-off, human-triggered editor preview),
 * `browserAction` executes unsupervised and repeatedly — via the scheduler, against a `startUrl`
 * that is itself `{{ }}`-interpolated from upstream data (see `browserActionExecutor.ts`), i.e.
 * from values this app does not fully control. A real, JS-executing browser reaching an internal
 * service is a materially bigger blast radius than a plain HTTP fetch would be (it renders and
 * runs whatever that internal page serves, and can be driven through it via the configured
 * steps) — hence this guard, deliberately not applied (yet) to the pre-existing `/render` route,
 * which stays a documented, accepted, lower-risk exception (see ARCHITECTURE.md).
 *
 * Deliberately NOT exhaustive: covers the common private/loopback/link-local ranges via plain
 * numeric/prefix checks, not a full IANA special-purpose registry. Does not defend against a
 * target that only redirects to a private address after this check has passed (Playwright's own
 * navigation would still follow that redirect) — a known, accepted gap for this iteration.
 */

/** Read fresh on every call (not cached at module load) so it can be set/changed at test time
 *  without depending on process-environment/module-import ordering. */
function isAllowlisted(hostname: string): boolean {
  return (process.env.BROWSER_WORKER_SSRF_ALLOWLIST ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .includes(hostname);
}

/** `a.b.c.d` → `[a, b, c, d]` as numbers. Assumes `isIPv4(address)` already passed. */
function ipv4Octets(address: string): [number, number, number, number] {
  const parts = address.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = ipv4Octets(address);
  return (
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a === 127 || // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
    a === 0 // 0.0.0.0/8 (unspecified/"this network")
  );
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") {
    return true; // loopback
  }
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // fe80::/10, link-local
  }
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) {
    return true; // fc00::/7, unique local
  }
  const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mappedV4?.[1] !== undefined && isIPv4(mappedV4[1])) {
    return isPrivateIPv4(mappedV4[1]);
  }
  return false;
}

/**
 * Resolves `url`'s hostname and rejects (400) if it resolves to a private/loopback/link-local
 * address, unless the hostname is listed in `BROWSER_WORKER_SSRF_ALLOWLIST` (comma-separated,
 * for local fixtures/tests). Rejects non-http(s) protocols outright.
 */
export async function assertPublicTarget(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException(`Invalid URL: "${url}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestException(`Unsupported protocol "${parsed.protocol}" for "${url}"`);
  }

  // `URL#hostname` keeps the surrounding brackets for an IPv6 literal (`"[::1]"`, not `"::1"`) —
  // stripped here since neither `dns.lookup` nor the allowlist/range checks below expect them.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isAllowlisted(hostname)) {
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestException(`Could not resolve host "${hostname}": ${message}`);
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      throw new BadRequestException(
        `Target "${url}" resolves to a private/internal address (${address}) — refusing to navigate there.`,
      );
    }
  }
}
