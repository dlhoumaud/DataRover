import { afterEach, describe, expect, it } from "vitest";
import { assertPublicTarget } from "./ssrfGuard";

describe("assertPublicTarget", () => {
  const originalAllowlist = process.env.BROWSER_WORKER_SSRF_ALLOWLIST;

  afterEach(() => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = originalAllowlist;
  });

  it("rejects an invalid URL", async () => {
    await expect(assertPublicTarget("not a url")).rejects.toThrow(/Invalid URL/);
  });

  it("rejects a non-http(s) protocol", async () => {
    await expect(assertPublicTarget("file:///etc/passwd")).rejects.toThrow(/Unsupported protocol/);
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.16.0.5/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/", // link-local — cloud metadata endpoints live here
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
  ])("rejects the private/loopback/link-local target %s", async (url) => {
    await expect(assertPublicTarget(url)).rejects.toThrow(/private|internal/i);
  });

  it.each(["http://8.8.8.8/", "http://1.1.1.1/", "http://172.32.0.1/", "http://172.15.255.255/"])(
    "accepts the public target %s",
    async (url) => {
      await expect(assertPublicTarget(url)).resolves.toBeUndefined();
    },
  );

  it("bypasses the check for a hostname on BROWSER_WORKER_SSRF_ALLOWLIST", async () => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = "127.0.0.1, other.local";
    await expect(assertPublicTarget("http://127.0.0.1/nope")).resolves.toBeUndefined();
  });

  it("still rejects a private host not on the allowlist", async () => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = "other.local";
    await expect(assertPublicTarget("http://10.0.0.1/nope")).rejects.toThrow(/private|internal/i);
  });
});
