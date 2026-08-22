import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startLiveApp } from "./support/liveApp";

// Same real-Chrome assumption as render.e2e.test.ts / session.e2e.test.ts (see their own comments).
describe("GET /session/live", () => {
  let server: Server;
  let fixtureUrl: string;
  let wsUrl: string;
  let closeApp: () => Promise<void>;
  const originalAllowlist = process.env.BROWSER_WORKER_SSRF_ALLOWLIST;

  beforeAll(async () => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = "127.0.0.1";
    const live = await startLiveApp();
    wsUrl = live.wsUrl;
    closeApp = live.close;

    server = createServer((req, res) => {
      if (req.url === "/interact") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body style="margin:0;height:3000px;">` +
            `<button id="mybutton" style="position:fixed;top:10px;left:10px;width:100px;height:30px;" ` +
            `onclick="document.getElementById('result').textContent='clicked'">Go</button>` +
            `<input id="myinput" style="position:fixed;top:60px;left:10px;width:100px;height:20px;" />` +
            `<div id="hovertarget" style="position:fixed;top:90px;left:10px;width:100px;height:20px;">Hover me</div>` +
            `<div id="result">not clicked</div>` +
            // Two elements sharing the same "clean own class" and neither carrying an id — mirrors
            // the real production bug (a common ".full-width" utility class matching hundreds of
            // elements on a real site). Wrapping the first one in a uniquely-classed parent gives
            // the recorder a later, unique candidate (".unique-wrapper .full-width") to fall back
            // to once it notices ".full-width" alone isn't unique.
            `<div class="unique-wrapper"><div class="full-width" ` +
            `style="position:fixed;top:150px;left:10px;width:120px;height:30px;" ` +
            `onclick="document.getElementById('result').textContent='clicked-ambiguous'">Ambiguous target</div></div>` +
            `<div class="full-width" style="position:fixed;top:190px;left:10px;width:120px;height:20px;">Other element sharing the same class</div>` +
            // Two links sharing the same nav classes — mirrors a second real production bug found
            // right after the first ('.nav-link.clickable2' resolving to 35 real menu items).
            // Unlike the '.full-width' case above, these DO carry a distinguishing attribute
            // (`href`) that candidateSelectors now proposes ahead of the shared class.
            `<a class="nav-link clickable2" href="/cannes-c7/" ` +
            `style="position:fixed;top:230px;left:10px;width:120px;height:20px;">Cannes</a>` +
            `<a class="nav-link clickable2" href="/moulinets-c14/" ` +
            `style="position:fixed;top:260px;left:10px;width:120px;height:20px;">Moulinets</a>` +
            // Neither the shared class NOR the repeated title is unique alone — "badge" matches
            // both this element and its sibling below, "En stock" matches both this element and
            // the unrelated ".tag" element further down — but the exact (class, title) PAIR
            // narrows to exactly this one.
            `<span class="badge" title="En stock" ` +
            `style="position:fixed;top:290px;left:10px;width:120px;height:20px;">A</span>` +
            `<span class="badge" title="Rupture" ` +
            `style="position:fixed;top:320px;left:10px;width:120px;height:20px;">B</span>` +
            `<span class="tag" title="En stock" ` +
            `style="position:fixed;top:350px;left:10px;width:120px;height:20px;">C</span>` +
            // Mirrors a real carousel library (slick.js) cloning a slide's entire markup verbatim
            // for a seamless infinite-loop effect: two of these three <img> elements are
            // byte-for-byte identical to each other (same class, same src, same alt — no
            // combination of the IMG's own attributes can ever tell them apart), but only the
            // clones' slide *wrapper* carries the "slick-cloned" marker class the real one lacks.
            `<div class="slick-slide slick-cloned" style="position:fixed;top:380px;left:10px;width:120px;height:20px;">` +
            `<img class="promo-slide-img" src="/promo.jpg" alt="Promo" style="display:block;width:100%;height:100%;" /></div>` +
            `<div class="slick-slide" style="position:fixed;top:410px;left:10px;width:120px;height:20px;">` +
            `<img class="promo-slide-img" src="/promo.jpg" alt="Promo" style="display:block;width:100%;height:100%;" /></div>` +
            `<div class="slick-slide slick-cloned" style="position:fixed;top:440px;left:10px;width:120px;height:20px;">` +
            `<img class="promo-slide-img" src="/promo.jpg" alt="Promo" style="display:block;width:100%;height:100%;" /></div>` +
            `</body></html>`,
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture server did not bind to a TCP port");
    }
    fixtureUrl = `http://127.0.0.1:${String(address.port)}`;
  }, 30_000);

  afterAll(async () => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = originalAllowlist;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeApp();
  });

  const openSockets: WebSocket[] = [];
  function connect(): WebSocket {
    const socket = new WebSocket(wsUrl);
    openSockets.push(socket);
    return socket;
  }

  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      socket.close();
    }
  });

  /** Collects every parsed JSON message received, resolving as soon as one satisfies `predicate`. */
  function waitForMessage(
    socket: WebSocket,
    predicate: (message: Record<string, unknown>) => boolean,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", onMessage);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for a matching message`));
      }, timeoutMs);

      function onMessage(raw: Buffer): void {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (predicate(parsed)) {
          clearTimeout(timer);
          socket.off("message", onMessage);
          resolve(parsed);
        }
      }

      socket.on("message", onMessage);
    });
  }

  function waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
  }

  it("streams at least one screencast frame after navigating", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));

    await waitForMessage(socket, (m) => m.type === "ready");
    await waitForMessage(socket, (m) => m.type === "frame");
  }, 30_000);

  it("replays mouse coordinates into a real click and records it as a semantic action", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside #mybutton's fixed 10..110 x, 10..40 y box.
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 25 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 25 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 25 }));

    const action = await waitForMessage(socket, (m) => m.type === "action");
    expect(action.step).toMatchObject({ type: "click", selector: "#mybutton" });
  }, 30_000);

  it("picks a unique selector over a non-unique shared class (regression for the '.full-width'-style strict-mode-violation bug)", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside the ambiguous target's fixed 10..130 x, 150..180 y box. Its own ".full-width" class
    // also matches a second, unrelated element elsewhere on the page — recording it as-is would
    // reproduce the real bug (Playwright's strict-mode violation on replay).
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 165 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 165 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 165 }));

    const action = await waitForMessage(socket, (m) => m.type === "action");
    const selector = (action.step as Record<string, unknown>).selector;
    expect(selector).not.toBe(".full-width");
    expect(selector).toBe(".unique-wrapper .full-width");
  }, 30_000);

  it("picks an href-based selector over a shared nav-link class (regression for the '.nav-link.clickable2' strict-mode-violation bug)", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside the first nav link's fixed 10..130 x, 230..250 y box. Its own class is shared with a
    // second, unrelated link elsewhere on the page — recording it as-is would reproduce the real
    // bug (Playwright's strict-mode violation on replay).
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 240 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 240 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 240 }));

    const action = await waitForMessage(socket, (m) => m.type === "action");
    const selector = (action.step as Record<string, unknown>).selector;
    expect(selector).not.toBe(".nav-link.clickable2");
    expect(selector).toBe('a[href="/cannes-c7/"]');
  }, 30_000);

  it("picks a class+attribute compound selector when neither the class nor the attribute alone is unique, but their combination is", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside the first "badge" span's fixed 10..130 x, 290..310 y box. ".badge" alone matches a
    // sibling too, and title="En stock" alone matches an unrelated ".tag" element too.
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 300 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 300 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 300 }));

    const action = await waitForMessage(socket, (m) => m.type === "action");
    const selector = (action.step as Record<string, unknown>).selector;
    expect(selector).not.toBe(".badge");
    expect(selector).not.toBe('span[title="En stock"]');
    expect(selector).toBe('.badge[title="En stock"]');
  }, 30_000);

  it("excludes a cloned-slide wrapper's marker class to isolate the real element, when two elements are otherwise byte-for-byte identical (regression for the real 'img.full-width' 210-match carousel-clone bug)", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside the middle (real, non-cloned) slide's fixed 10..130 x, 410..430 y box. Its own <img>
    // is attribute-for-attribute identical to the two clones above/below it — only the slide
    // wrapper's "slick-cloned" marker class tells them apart.
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 420 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 420 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 420 }));

    const action = await waitForMessage(socket, (m) => m.type === "action");
    const selector = (action.step as Record<string, unknown>).selector;
    expect(selector).toBe('div.slick-slide:not(.slick-cloned) img[src="/promo.jpg"]');
  }, 30_000);

  it("records typed text as one 'type' step on blur, not one step per keystroke", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Focus #myinput (10..110 x, 60..80 y).
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "keyDown", key: "x" }));
    socket.send(JSON.stringify({ type: "keyUp", key: "x" }));
    // Blur by clicking elsewhere (outside both the input and the button).
    socket.send(JSON.stringify({ type: "mouseMove", x: 200, y: 200 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 200, y: 200 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 200, y: 200 }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "type";
    });
    expect(action.step).toMatchObject({ type: "type", selector: "#myinput", text: "x" });
  }, 30_000);

  it("records a standalone key press (not tied to any text field) as a 'press' step", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    socket.send(JSON.stringify({ type: "keyDown", key: "Enter" }));
    socket.send(JSON.stringify({ type: "keyUp", key: "Enter" }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "press";
    });
    expect(action.step).toMatchObject({ type: "press", key: "Enter" });
  }, 30_000);

  it("records a printable key press outside any text field as a 'press' step too", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Nothing is focused (no prior click) — target is <body>, never an editable field.
    socket.send(JSON.stringify({ type: "keyDown", key: "a" }));
    socket.send(JSON.stringify({ type: "keyUp", key: "a" }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "press";
    });
    expect(action.step).toMatchObject({ type: "press", key: "a" });
  }, 30_000);

  it("records a 'press' for a printable key even inside a text field, alongside the field's own aggregate 'type'", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    const collected: Record<string, unknown>[] = [];
    socket.on("message", (raw: Buffer) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (parsed.type === "action") collected.push(parsed.step as Record<string, unknown>);
    });

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Focus #myinput (10..110 x, 60..80 y), then type a plain character into it.
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 70 }));
    socket.send(JSON.stringify({ type: "keyDown", key: "a" }));
    socket.send(JSON.stringify({ type: "keyUp", key: "a" }));
    // Blur by clicking elsewhere, which is what actually emits the 'type' step.
    socket.send(JSON.stringify({ type: "mouseMove", x: 200, y: 200 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 200, y: 200 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 200, y: 200 }));

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(collected.some((step) => step.type === "press" && (step as { key?: unknown }).key === "a")).toBe(true);
    expect(collected.some((step) => step.type === "type")).toBe(true);
  }, 30_000);

  it("records mouse movement, debounced to where the pointer settles, as a 'moveMouse' step", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Several quick moves — recorded as exactly one settled 'moveMouse' at the final position,
    // not one per mousemove event (there can be dozens per second during a real drag).
    socket.send(JSON.stringify({ type: "mouseMove", x: 300, y: 150 }));
    socket.send(JSON.stringify({ type: "mouseMove", x: 320, y: 160 }));
    socket.send(JSON.stringify({ type: "mouseMove", x: 340, y: 170 }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "moveMouse";
    });
    expect(action.step).toMatchObject({ type: "moveMouse", x: 340, y: 170 });
  }, 30_000);

  it("records the page's scroll position, debounced to one 'scrollPage' step", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Several quick wheel ticks — recorded as exactly one settled 'scrollPage', not one per tick.
    socket.send(JSON.stringify({ type: "wheel", deltaX: 0, deltaY: 100 }));
    socket.send(JSON.stringify({ type: "wheel", deltaX: 0, deltaY: 100 }));
    socket.send(JSON.stringify({ type: "wheel", deltaX: 0, deltaY: 100 }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "scrollPage";
    });
    expect(action.step).toMatchObject({ type: "scrollPage" });
    expect(Number((action.step as Record<string, unknown>).y)).toBeGreaterThan(0);
  }, 30_000);

  it("records a genuine hover dwell (not a passing mouseover) as a 'hover' step", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Inside #hovertarget's fixed 10..110 x, 90..110 y box — held there past the dwell threshold.
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 100 }));

    const action = await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "hover";
    });
    expect(action.step).toMatchObject({ type: "hover", selector: "#hovertarget" });
  }, 30_000);

  it("never records a 'hover' for resting on the empty page background (<body>/<html>)", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    // Below every fixed element — lands directly on <body>, held well past the dwell threshold.
    socket.send(JSON.stringify({ type: "mouseMove", x: 500, y: 500 }));

    // The move itself is expected to still record as a 'moveMouse' (that's a separate feature,
    // covered by its own test) — only 'hover' on <body>/<html> is what must never appear.
    const collected: Record<string, unknown>[] = [];
    const listener = (raw: Buffer): void => {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (parsed.type === "action") collected.push(parsed.step as Record<string, unknown>);
    };
    socket.on("message", listener);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    socket.off("message", listener);

    expect(collected.some((step) => step.type === "hover")).toBe(false);
  }, 30_000);

  it("inserts an auto 'wait' step reflecting the pause between two recorded actions", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: `${fixtureUrl}/interact` }));
    await waitForMessage(socket, (m) => m.type === "ready");

    socket.send(JSON.stringify({ type: "startRecording" }));
    socket.send(JSON.stringify({ type: "mouseMove", x: 50, y: 25 }));
    socket.send(JSON.stringify({ type: "mouseDown", x: 50, y: 25 }));
    socket.send(JSON.stringify({ type: "mouseUp", x: 50, y: 25 }));
    await waitForMessage(socket, (m) => {
      const step = m.type === "action" ? (m.step as Record<string, unknown> | undefined) : undefined;
      return step?.type === "click";
    });
    // A single collector, not a sequence of one-shot `waitForMessage` calls: the server can send
    // two action steps back-to-back, synchronously, in the same handler (the auto-inserted 'wait'
    // and the action it precedes, but also a recorded 'moveMouse' any time the cursor moves) —
    // both can arrive in the same tick, before a *second*, freshly-`await`ed `waitForMessage` call
    // has had a chance to register its own listener. A single listener that simply accumulates
    // every step has no such gap to race.
    const collected: Record<string, unknown>[] = [];
    const collectSteps = (raw: Buffer): void => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (parsed.type === "action") {
        collected.push(parsed.step as Record<string, unknown>);
      }
    };
    socket.on("message", collectSteps);

    // Off #mybutton specifically — otherwise the cursor, left resting there, would itself cross
    // the hover dwell threshold *and* the mouse-move settle threshold during the sleep below,
    // recording an unrelated 'hover'/'moveMouse' pair that would muddy this test's one 'wait' gap
    // with a second, shorter one. Recorded here (settles within `MOUSE_MOVE_SETTLE_MS`) then
    // discarded below, rather than pretending it doesn't happen.
    socket.send(JSON.stringify({ type: "mouseMove", x: 500, y: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    collected.length = 0; // only what happens from here on is this test's actual subject

    await new Promise((resolve) => setTimeout(resolve, 1000));
    socket.send(JSON.stringify({ type: "keyDown", key: "Tab" }));
    socket.send(JSON.stringify({ type: "keyUp", key: "Tab" }));
    // The collector is already listening — no race to poll for, just give the round trip
    // (Playwright dispatching the key event, the recorder's listener, the socket relay) time.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    socket.off("message", collectSteps);

    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({ type: "wait" });
    const ms = Number((collected[0] as Record<string, unknown>).ms);
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThanOrEqual(15_000);
    // The 'wait' always precedes the action it was paced in front of, never the other way round.
    expect(collected[1]).toMatchObject({ type: "press", key: "Tab" });
  }, 30_000);

  it("rejects a non-allowlisted private startUrl with an error message, not a crash", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "start", startUrl: "http://10.0.0.1/nope" }));

    const error = await waitForMessage(socket, (m) => m.type === "error");
    expect(String(error.message)).toMatch(/private|internal/i);
  });

  it("returns an error (not a crash) for a message sent before 'start'", async () => {
    const socket = connect();
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "mouseMove", x: 1, y: 1 }));

    const error = await waitForMessage(socket, (m) => m.type === "error");
    expect(String(error.message)).toMatch(/before "start"/);
  });
});
