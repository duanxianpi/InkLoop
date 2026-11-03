import { DurableObject } from 'cloudflare:workers';

// First-deployment placeholder: fails closed while D1 is provisioned and migrated.
export default {
  fetch() {
    return Response.json(
      { error: 'deployment_initializing' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
    );
  },
};

// The shared wrangler config declares this Durable Object class, so the placeholder must export it too.
export class ChangeHub extends DurableObject {}
