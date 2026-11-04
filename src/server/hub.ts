import { DurableObject } from 'cloudflare:workers';
import type { ChangeMessage } from '../shared/model';

// ChangeHub: one Durable Object per deployment that pushes `ChangeMessage` ({ type: 'changed', seq })
// to open pages over hibernatable WebSockets after each committed write that changes what pages show.
// Messages carry only the change counter; pages fetch data through the authenticated API.

/** A socket is authorized by its opening handshake for this long; the page then reconnects. */
const SOCKET_LIFETIME_MS = 60 * 60 * 1000;

interface Attachment {
  authEpoch: number;
  expiresAt: number;
}

export class ChangeHub extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** WebSocket upgrade, forwarded by the Worker after session and Origin checks (header X-Auth-Epoch). */
  async fetch(request: Request): Promise<Response> {
    const authEpoch = Number(request.headers.get('X-Auth-Epoch'));
    if (
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
      !Number.isSafeInteger(authEpoch)
    )
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { authEpoch, expiresAt: Date.now() + SOCKET_LIFETIME_MS };
    server.serializeAttachment(attachment);
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(attachment.expiresAt);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Broadcast the committed counter; close sockets opened under an older auth epoch or expired. */
  async notify(seq: number, authEpoch: number): Promise<void> {
    const message = JSON.stringify({ type: 'changed', seq } satisfies ChangeMessage);
    const time = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment || attachment.authEpoch !== authEpoch || attachment.expiresAt <= time) {
        socket.close(4001, 'reauthenticate');
        continue;
      }
      try {
        socket.send(message);
      } catch {
        // A socket that is already closing is dropped by the runtime.
      }
    }
  }

  /** Close expired sockets and wake again for the next expiry. */
  async alarm(): Promise<void> {
    const time = Date.now();
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (!attachment || attachment.expiresAt <= time) socket.close(4001, 'reauthenticate');
      else next = Math.min(next, attachment.expiresAt);
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(next);
  }

  async webSocketMessage(): Promise<void> {
    // Pages never send anything but the auto-answered ping.
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    try {
      socket.close(1000, 'closed');
    } catch {
      // Already closed.
    }
  }
}
