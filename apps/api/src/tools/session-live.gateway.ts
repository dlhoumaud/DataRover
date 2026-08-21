import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";

/** Same env var `BrowserWorkerClient` uses for its own (plain HTTP) calls — converted from
 *  http(s) to ws(s) rather than introducing a second, separately-configured URL. */
function browserWorkerLiveUrl(): string {
  const baseUrl = process.env.BROWSER_WORKER_URL ?? "http://localhost:3002";
  return `${baseUrl.replace(/^http/, "ws")}/session/live`;
}

/**
 * Registers `GET /tools/session-live` — the *only* thing the frontend ever talks to for the
 * browserAction node's live preview/recorder; `browser-worker` itself stays `expose`-only on the
 * Docker network (see docker-compose.yml), never reachable from outside it, exactly like its
 * existing `/render` (fronted by `BrowserWorkerClient`) and this route's own batch counterpart
 * (`/session/run`, fronted by `browserActionExecutor.ts`). The difference here is this route
 * proxies a live, bidirectional, stateful connection rather than making one request and returning
 * one response — for every browser connection, this opens exactly one upstream connection to
 * `browser-worker` and relays messages both ways for as long as either side stays open.
 *
 * Same "grab the raw Fastify instance via HttpAdapterHost" pattern as
 * `apps/browser-worker/src/session/session-live.gateway.ts` — see its own doc comment for why
 * there's no first-class Nest decorator for a route shaped this way.
 */
@Injectable()
export class SessionLiveProxyGateway implements OnModuleInit {
  private readonly logger = new Logger(SessionLiveProxyGateway.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.httpAdapterHost.httpAdapter.getInstance<FastifyInstance>();
    await fastify.register(fastifyWebsocket);
    fastify.get("/tools/session-live", { websocket: true }, (clientSocket: WebSocket) => {
      this.proxy(clientSocket);
    });
  }

  /**
   * Wires one browser connection to one fresh upstream connection. Messages arriving before the
   * upstream socket finishes connecting are queued rather than dropped — the frontend's very
   * first message (`{"type":"start",...}`) would otherwise race the upstream handshake. Either
   * side closing or erroring closes the other: an abrupt browser-tab close must never leave a
   * `browser-worker` session (and the real Playwright browser process behind it) running forever
   * with nothing left to talk to it.
   */
  private proxy(clientSocket: WebSocket): void {
    const upstream = new WebSocket(browserWorkerLiveUrl());
    const pending: string[] = [];
    let upstreamOpen = false;

    upstream.on("open", () => {
      upstreamOpen = true;
      for (const message of pending.splice(0)) {
        upstream.send(message);
      }
    });

    upstream.on("message", (data: Buffer) => {
      if (clientSocket.readyState === clientSocket.OPEN) {
        clientSocket.send(data.toString());
      }
    });

    upstream.on("close", () => {
      if (clientSocket.readyState === clientSocket.OPEN) {
        clientSocket.close();
      }
    });

    upstream.on("error", (error: Error) => {
      this.logger.warn(`session-live proxy: upstream connection error: ${error.message}`);
      if (clientSocket.readyState === clientSocket.OPEN) {
        clientSocket.close();
      }
    });

    clientSocket.on("message", (raw: Buffer) => {
      const message = raw.toString();
      if (upstreamOpen) {
        upstream.send(message);
      } else {
        pending.push(message);
      }
    });

    clientSocket.on("close", () => {
      upstream.close();
    });

    clientSocket.on("error", (error: Error) => {
      this.logger.warn(`session-live proxy: client connection error: ${error.message}`);
      upstream.close();
    });
  }
}
