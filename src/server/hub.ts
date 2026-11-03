import { DurableObject } from 'cloudflare:workers';

// ChangeHub: one Durable Object per deployment that pushes `ChangeMessage` ({ type: 'changed', seq })
// to open pages over hibernatable WebSockets after each committed write that changes what pages show.
// Messages carry only the change counter; pages fetch data through the authenticated API.
export class ChangeHub extends DurableObject<unknown> {
  /** WebSocket upgrade, forwarded by the Worker after session and Origin checks (header X-Auth-Epoch). */
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: 'not_implemented' }, { status: 501 });
  }

  /** Broadcast the committed counter; close sockets opened under an older auth epoch. */
  async notify(_seq: number, _authEpoch: number): Promise<void> {
    throw new Error('not_implemented');
  }
}
