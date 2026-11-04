// Local board preview: the real Worker, D1, R2 and ChangeHub in Miniflare, with sample problems.
// Nothing is deployed and no real credentials exist. Run `npm run build` first, then
//   node tests/preview-board.mjs
// and open the printed URL. Seed feedback with:
//   node tests/preview-board.mjs feedback <problem_id> [correct|partial|incorrect]
import { createRequire } from 'node:module';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { applyMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }),
);

const port = Number(process.env.PORT ?? 8788);
const origin = `http://localhost:${port}`;

async function mcp(name, args) {
  const response = await fetch(origin + '/__test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return (await response.json()).result.structuredContent;
}

if (process.argv[2] === 'feedback') {
  const [problem_id, verdict] = process.argv.slice(3);
  const submission = await mcp('get_submission', { problem_id });
  if (submission.status !== 'ready')
    throw new Error('No Snapshot yet: mark the problem ready first.');
  console.log(
    await mcp('append_feedback', {
      problem_id,
      snapshot_id: submission.snapshot_id,
      verdict: verdict || undefined,
      feedback:
        'The setup is right: write the KL divergence as $\\mathbb{E}_p[\\log p(x) - \\log q(x)]$. Check the constant term; with $p = q$ the result must be $0$.',
      callouts: [
        {
          kind: 'correct',
          math: '\\mathbb{E}_p[(x-\\mu_2)^2] = \\sigma_1^2 + (\\mu_1-\\mu_2)^2',
          text: 'Good: this is the key expectation.',
        },
        { kind: 'fix', math: '-\\tfrac12', text: 'Show where the $-\\tfrac12$ comes from.' },
      ],
    }),
  );
  process.exit(0);
}

const bundle = await build({
  entryPoints: ['tests/fixtures/product-worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:*', 'node:*'],
  write: false,
  logLevel: 'warning',
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-02',
    compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    d1Databases: ['DB'],
    kvNamespaces: ['OAUTH_KV'],
    r2Buckets: ['STORAGE'],
    durableObjects: { CHANGE_HUB: { className: 'ChangeHub', useSQLite: true } },
    assets: {
      directory: 'dist/public',
      binding: 'ASSETS',
      routerConfig: { has_user_worker: true },
      run_worker_first: ['/*', '!/assets/*'],
      assetConfig: { html_handling: 'none', not_found_handling: 'none' },
    },
    bindings: process.env.PREVIEW_D1_CONSOLE_URL
      ? { D1_CONSOLE_URL: process.env.PREVIEW_D1_CONSOLE_URL }
      : {},
    host: 'localhost',
    port,
  }),
);
await mf.ready;
const db = await mf.getD1Database('DB');
await applyMigrations(db);
// PREVIEW_FRESH=1: a deployment nobody has set up yet, to look at /setup.
if (process.env.PREVIEW_FRESH) {
  console.log(`Fresh preview: ${origin}/setup`);
  await new Promise(() => {});
}
await db.prepare('INSERT INTO owner VALUES(1,unixepoch())').run();
await db
  .prepare(
    'UPDATE auth_state SET initialized_at=unixepoch(),canonical_origin=?,rp_id=?,auth_epoch=1',
  )
  .bind(origin, 'localhost')
  .run();
// Preview password for /login and /settings/password: "inkloop".
const salt = randomBytes(16).toString('base64url');
const derived = pbkdf2Sync('inkloop', Buffer.from(salt, 'base64url'), 600000, 32, 'sha256');
await db
  .prepare('INSERT INTO owner_password VALUES (1, ?, 600000, ?, unixepoch())')
  .bind(salt, createHash('sha256').update(derived.toString('base64url')).digest('base64url'))
  .run();
const token = randomBytes(32).toString('base64url');
await db
  .prepare('INSERT INTO web_sessions VALUES(?,1,1,unixepoch()+86400,unixepoch())')
  .bind(createHash('sha256').update(token).digest('base64url'))
  .run();

const w7 = await mcp('create_problems', {
  request_id: 'seed-w7',
  new_set: {
    title: 'W7 · Variational inference',
    new_collection_title: 'CSC2506 · Probabilistic Learning',
  },
  problems: [
    {
      title: 'KL between Gaussians',
      type: 'Derivations',
      body: 'Let $p = \\mathcal{N}(\\mu_1, \\sigma_1^2)$ and $q = \\mathcal{N}(\\mu_2, \\sigma_2^2)$ be univariate Gaussians. Show that $$\\mathrm{KL}(p \\,\\|\\, q) = \\log\\frac{\\sigma_2}{\\sigma_1} + \\frac{\\sigma_1^2 + (\\mu_1 - \\mu_2)^2}{2\\sigma_2^2} - \\frac{1}{2}.$$',
    },
    {
      title: 'Derive the ELBO',
      type: 'Derivations',
      body: "Starting from $\\log p(x) = \\log \\int p(x, z)\\,dz$, use Jensen's inequality to derive the evidence lower bound $$\\mathcal{L}(q) = \\mathbb{E}_{q(z)}[\\log p(x, z)] - \\mathbb{E}_{q(z)}[\\log q(z)],$$ and show that the gap is exactly a KL divergence.",
    },
    {
      title: 'Reparameterisation',
      type: 'Short answer',
      body: 'Let $z = \\mu + \\sigma\\varepsilon$ with $\\varepsilon \\sim \\mathcal{N}(0, 1)$. Write $\\frac{\\partial}{\\partial \\mu}\\mathbb{E}[f(z)]$ as an expectation over $\\varepsilon$.\n\nExplain **briefly** why this estimator usually has lower variance than REINFORCE.',
    },
  ],
});
await mcp('create_problems', {
  request_id: 'seed-w6',
  new_set: { title: 'W6 · EM and mixtures', collection_id: w7.collection_id },
  problems: [
    {
      title: 'E-step responsibilities',
      type: 'Derivations',
      body: 'For a Gaussian mixture with weights $\\pi_k$, means $\\mu_k$ and covariances $\\Sigma_k$, write down the E-step responsibilities $r_{nk}$.',
    },
  ],
});
await mcp('create_problems', {
  request_id: 'seed-la',
  new_set: { title: 'Drills', new_collection_title: 'Linear algebra drills' },
  problems: [
    {
      title: 'Orthogonal eigenvectors',
      type: 'Proofs',
      body: 'Let $A \\in \\mathbb{R}^{n \\times n}$ be symmetric. Prove that eigenvectors corresponding to distinct eigenvalues are orthogonal.',
    },
  ],
});
console.log(`Board preview: ${origin}/__test/login?token=${token}`);
console.log(`Sign-in page: ${origin}/login (password: inkloop)`);
console.log('Problem IDs (W7):', w7.problem_ids.join(' '));
