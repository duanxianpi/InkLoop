# InkLoop

**Handwrite. Review. Refine.**

An open-source, self-hosted whiteboard for learning with your favorite AI.

Write on your tablet. Let ChatGPT, Claude, or another MCP-compatible AI assistant review your work. Make corrections directly on the same canvas and keep the conversation going.

**Your AI. Your whiteboard. Your rules.**

[Demo](#see-it-in-action) · [Get Started](#get-started) · [Make It Yours](#make-it-yours)

> **Status:** the first complete product slice is implemented and tested locally, but InkLoop is not released yet. Deployed OAuth-authorized MCP/D1 operations have been exercised. Physical-iPad testing, the complete deployed handwriting/image-review loop, reliable automatic token renewal, and data export/restore remain. See [remaining release work](docs/architecture.md#12-remaining-release-work).

---

## See It in Action

<!-- Demo video or GIF: AI creates a problem → handwritten solution on a tablet → Mark ready → AI feedback → handwritten correction → second review. -->

No screenshots. No uploads. No explaining what you changed since last time.

Just write, review, and refine.

## What It Is

A small, dedicated handwriting workspace that connects to the AI assistant you already use.

Not an AI tutor. Not a note-taking suite. Not a chatbot.

## How It Works

**1. Ask your AI for a problem**

In ChatGPT, Claude, or another compatible client, your assistant sends questions straight to InkLoop through MCP.

**2. Solve it by hand**

Open InkLoop on your tablet and write with your stylus. Equations, diagrams, scratch work, erasures — however you think.

**3. Mark it ready**

InkLoop commits a snapshot of your work and makes it available to your AI.

Nothing is graded or sent to a model automatically. You stay in control of the conversation.

**4. Get feedback**

Ask your AI to review. It retrieves your latest snapshot and attaches feedback to the exact version it reviewed.

**5. Refine and repeat**

Keep editing on the **same canvas**. Correct a mistake in another color, extend a derivation, answer a follow-up.

Mark it ready again, and your AI reviews the update. Earlier snapshots and feedback stay available.

**One canvas. Multiple revisions. A continuous learning loop.**

---

## Features

### Built for handwriting

- **Pen-first canvas** — a distraction-free surface for equations, diagrams, and sketches.
- **Tablet-friendly** — designed around stylus and touch, with desktop browser support.
- **Problem organization** — collections and problem sets, without turning your whiteboard into a learning management system.
- **Mark ready** — you decide when your work is ready for review.
- **Versioned snapshots** — every committed version of your work is preserved.
- **Feedback history** — reviews accumulate instead of replacing each other.

### Bring your own AI

InkLoop contains no LLM, hosts no chatbot, and needs no model API key.

It exposes your whiteboard to AI assistants through the **Model Context Protocol (MCP)**. Your AI creates problems, retrieves handwritten work, and appends feedback while the conversation stays in your existing client.

Use the model you prefer. Switch whenever you want.

_Client support depends on each client's MCP capabilities and permissions._

### Self-hosted by design

InkLoop runs in **your own Cloudflare account**.

- No InkLoop account or hosted subscription.
- No local computer or server that has to stay running.
- Your whiteboard data lives in your deployment.
- Your instance, your storage, your control.

One deployment gives you the web app, database, sign-in, and MCP server together.

_Cloudflare usage is subject to its service limits and pricing._

---

## Get Started

No terminal. No server. Just a GitHub account and a Cloudflare account.

**1. Fork InkLoop**

[Fork this repository](https://github.com/duanxianpi/InkLoop/fork) to your GitHub account.

**2. Enable R2 in your Cloudflare account**

In Cloudflare Dashboard, choose **Storage & databases → R2 → Overview** and complete the subscription checkout. R2 must be enabled before the first deployment; creating a Cloudflare account does not complete this step. Review the payment/billing details shown by Cloudflare. See [Cloudflare’s R2 setup instructions](https://developers.cloudflare.com/r2/get-started/#before-you-begin).

**3. Deploy your fork**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)

Choose **Import a repository**, connect GitHub, and select your fork. Set the deploy command to `npm run deploy`, then deploy.

Once R2 is enabled, the deploy command provisions the database and storage bindings and publishes your instance. It does not enable an R2 subscription on your behalf.

Follow the [illustrated post-deployment guide](docs/getting-started.md) ([中文图文教程](docs/getting-started.zh-CN.md)) to enable the Worker URL, retrieve the claim key and set your password.

**4. Claim your instance**

Open `/setup` on your new address and choose a password. The one-time setup key is in your database, viewable in the Cloudflare dashboard, and the setup page links to it when it can. See [Deployment](docs/deployment.md#claim-the-owner).

**5. Connect your AI**

Add your instance's MCP endpoint to your AI client and approve access:

```
https://<your-instance>/mcp
```

**6. Start writing**

Open your whiteboard on your tablet.

---

## Make It Yours

**Don't like something? Ask your coding agent to change it.**

A different toolbar. More pen colors. A layout for chemistry. A different review flow. A new MCP tool.

Your fork is yours. InkLoop gives you a working foundation — canvas, persistence, authentication, deployment, and MCP — so you only touch the parts you want to change.

### Customize → Push → Live

**1. Open your fork with your coding agent**

Use Codex, Claude Code, or any coding assistant, and describe what you want:

> Add a purple highlighter to InkLoop. Keep the existing handwriting, snapshot, and MCP functionality working. Update any relevant tests.

> Customize InkLoop for practicing chemistry. Keep the same canvas and feedback workflow, but adapt the question presentation and drawing tools.

**2. Push the change**

Cloudflare rebuilds and redeploys your instance from your fork. Your data stays where it is.

No waiting on upstream for the features you want — and **Sync fork** on GitHub still brings in upstream updates when you want them.

**It's your whiteboard. Make it work the way you think.**

### Customization philosophy

No hundreds of settings. No plugin system.

The source code is the customization surface — kept small and readable for people and coding agents alike. [Development](docs/development.md) covers local checks and previews.

---

## How InkLoop Connects to AI

Handwriting and AI reasoning stay separate.

| Component                  | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| **Your tablet or browser** | The handwriting canvas                                   |
| **Your InkLoop instance**  | Stores drawings, snapshots, and feedback                 |
| **MCP server**             | Connects the whiteboard to an external AI client         |
| **Your AI assistant**      | Creates exercises, reads handwriting, and gives feedback |

The AI never handles drawing coordinates, the database, or the canvas implementation. It receives your handwriting as an image, with the question and snapshot it belongs to.

### One rule for revisions

**One problem. One canvas. Multiple snapshots. Append-only feedback.**

Every committed snapshot has a stable, ordered identity. Your AI reviews the latest one, and its feedback is attached to that snapshot specifically.

Corrections never erase earlier work or reviews, and responding to feedback never needs a new question or page.

---

## What InkLoop Isn't

InkLoop isn't a replacement for Goodnotes, Notability, Samsung Notes, or your note-taking app of choice. Those are built for lectures, PDFs, and notebooks.

InkLoop does one thing:

**Write something by hand and let your AI assistant see it.**

It doesn't replace your AI conversations, schedule study sessions, or decide how you should learn. Exercises are the main use case, but the same loop works for sketches, diagrams, algorithms, and any other handwritten idea.

---

## Device Compatibility

InkLoop runs in the browser and is designed for pen-enabled tablets.

iPad with Apple Pencil is the primary target. Other capable browsers and stylus devices — Galaxy Tab with S Pen, Windows pen tablets — are goals too, as are older tablets that can't run current note apps but still make a good writing surface.

Browser support and pen latency vary by device. A tested compatibility matrix will follow physical-device testing.

---

## Built With

- **Cloudflare Workers** — one Worker serves the web app and MCP endpoint
- **D1** for structured data, private **R2** for drawings and snapshot images, **KV** for OAuth, a **Durable Object** for live updates
- **Hono** for routing, **React** for the app, **tldraw** for the canvas, **MathJax** for math in questions
- **workers-oauth-provider** for OAuth-protected MCP access
- **zod** schemas shared by the browser API and MCP tools

Read more in [Architecture](docs/architecture.md) and the [documentation index](docs/README.md).

---

## Contributing

Bug reports, ideas, and pull requests are welcome. Especially useful:

- Better stylus and touch support
- Compatibility with older tablets and browsers
- Accessibility and usability
- More reliable snapshot rendering
- Compatibility with more AI clients
- Clearer self-hosting and customization docs

Changes that make the core simpler, more reliable, and easier to understand are the most welcome of all.

## License

InkLoop's original code and documentation are available under the [MIT License](LICENSE). Third-party components retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.txt) and [Licensing](docs/licensing.md).

The pinned **tldraw 3.15.6** canvas SDK uses its own source-available license, which permits commercial and non-commercial use while requiring its native watermark and license validation to remain intact. It is not covered by InkLoop's MIT License. InkLoop is independently developed and is not affiliated with or endorsed by tldraw Inc. Newer SDK versions have different production-license requirements; review licensing before upgrading.

---

**Handwrite. Review. Refine.**

**Your AI. Your whiteboard. Your rules.**
