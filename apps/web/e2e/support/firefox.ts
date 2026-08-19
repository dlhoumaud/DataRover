import { existsSync } from "node:fs";

/**
 * Candidate paths for a real (non-wrapper) Firefox executable, checked in order. Selenium's own
 * binary auto-detection chokes on Ubuntu's snap-packaged Firefox: `/usr/bin/firefox` there is a
 * shell script wrapper, not an ELF binary, and Selenium rejects it with "binary is not a Firefox
 * executable". The actual binary lives inside the snap's mount point instead.
 *
 * `FIREFOX_BIN` lets any environment (CI, a different distro, macOS) override this entirely.
 */
const CANDIDATE_PATHS = [
  process.env.FIREFOX_BIN,
  "/snap/firefox/current/usr/lib/firefox/firefox", // Ubuntu snap (stable across snap revisions)
  "/usr/lib/firefox/firefox", // Debian/Ubuntu .deb package
  "/usr/lib/firefox-esr/firefox-esr", // Debian ESR package
  "/opt/firefox/firefox",
  "/Applications/Firefox.app/Contents/MacOS/firefox", // macOS
].filter((candidate): candidate is string => Boolean(candidate));

/**
 * Resolves the path to a real Firefox executable that Selenium can launch directly.
 *
 * Throws a clear, actionable error (rather than letting Selenium fail later with an opaque
 * "binary is not a Firefox executable") when nothing is found.
 */
export function resolveFirefoxBinary(): string {
  const found = CANDIDATE_PATHS.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not find a Firefox binary to drive for the e2e suite. Tried:\n` +
        CANDIDATE_PATHS.map((candidate) => `  - ${candidate}`).join("\n") +
        `\nInstall Firefox, or set FIREFOX_BIN to the full path of the firefox executable.`,
    );
  }
  return found;
}
