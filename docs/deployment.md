# Deployment and recovery

The repository currently deploys an authentication foundation and an empty product shell. Deployment does not enable the unimplemented drawing, storage or feedback services.

## Requirements

Use Node.js 22.12 or later, the committed npm lockfile, and a Cloudflare account with Workers, D1, KV and R2 available. Use an HTTPS deployment address that can remain stable: owner setup binds Passkeys and OAuth to it. No upstream OAuth app, Cloudflare Access policy or model API key is required.

The configuration declares one Worker, a D1 database, an OAuth KV namespace, a private R2 bucket, a SQLite-backed ChangeHub Durable Object and an authentication rate-limit binding. Billing and account availability depend on the deployment's Cloudflare settings; this project does not promise a free operating tier.

## Terminal deployment

```sh
npm ci
npm run typecheck
npm run build
npm test
npx wrangler login
npm run deploy
```

`src/tooling/deploy.mjs` first attempts D1 migrations. If the database has not been provisioned, it deploys a maintenance entry that returns 503, provisions bindings, applies migrations, and then publishes the real Worker. Other migration failures stop deployment. The maintenance entry also exports ChangeHub to match the shared Wrangler configuration.

Build before deploy: `dist/public/` must contain the SPA HTML and its hashed JS/CSS assets. The deploy command uses Wrangler to bundle Worker source. Keep generated local binding state for subsequent deployments and verify you are targeting the existing resources before an upgrade.

## Git-connected deployment

Import your copy of this repository into Cloudflare Workers using its Git integration. Configure `npm run build` as the build command and `npm run deploy` as the deploy command. Use the repository's `wrangler.jsonc` and migrations. Complete any platform prompts for resource availability, including R2.

This describes the intended Whiteboard deployment procedure. A new full deployment of this React-auth revision has not yet been accepted end-to-end; local tests do not substitute for that release check.

## Claim the owner

1. Open `/setup` at the permanent HTTPS address.
2. In Cloudflare Dashboard, open the Worker's **DB** binding and inspect `admin_keys`.
3. Copy `secret_display` from the `bootstrap` row into the setup form. The website never retrieves or displays this key.
4. Confirm the displayed origin and register a Passkey.
5. The bootstrap key is consumed. The recovery key is stored in the D1 `recovery` row.

The same key can be read in the D1 console with:

```sql
SELECT secret_display FROM admin_keys WHERE purpose = 'bootstrap';
```

After initialization, `/app` requires the owner session. Add compatible MCP clients using `https://YOUR-HOST/mcp` and approve their requested scopes. Full client-specific onboarding remains a release validation item.

## Recovery and connected applications

Open `/recover`, retrieve the `recovery` key from D1, and register a replacement Passkey. Successful recovery rotates that key and invalidates previous Passkeys, Web sessions and MCP authorizations. Retrieve the new key from D1 when needed; keep it out of URLs, logs and source control.

Use `/settings/passkeys/add` to add a Passkey after recent sign-in. Use `/settings/connected-apps` to inspect and revoke a particular MCP authorization; revocation also requires recent sign-in. Signing out of the Web does not revoke an independently authorized MCP client.

## Upgrades and durability

Never rewrite migrations `0001`–`0003` on a deployed instance. Append migrations and preserve binding identities. A code rollback does not reverse database migrations.

Product export/restore and orphan-object collection are not implemented. Before production use, verify backup and restore across D1 metadata and referenced R2 objects; restoring only one store is not a complete product recovery procedure.
