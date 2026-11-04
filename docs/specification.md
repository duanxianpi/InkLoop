# InkLoop — Product Specification

**Version:** 1.0 — Product behavior requirements  
**Status:** Implementation target; implemented except for the release checks listed in [Architecture](architecture.md#2-current-implementation-status)  
**Product:** InkLoop  
**Tagline:** _Give your AI a whiteboard._  
**Architecture:** Bring Your Own AI · Pen-first · MCP-native · Self-hosted

## 0. Document Authority

This document defines the intended product behavior, not a claim that those features are available today. See [Architecture](architecture.md) for the implemented foundation, selected technical design and remaining work, and [API contracts](api.md) for the current interfaces.

The internal drawing prototype informed these requirements. It is a behavioral reference, not production source code or a dependency required to build this repository. Explicit requirements below take precedence over prototype behavior.

Requirements use the following terminology:

- **MUST:** Required for v1.0.
- **SHOULD:** Expected unless there is a strong technical or UX reason.
- **MAY:** Optional implementation detail.

The product model, core workflows, and interaction semantics are frozen. Technical implementation details may be optimized without changing externally observable behavior.

---

# Part I — Product Specification

## 1. Product Identity

InkLoop is a lightweight, self-hosted writing surface that enables existing AI Agents to interact with handwritten information.

The application has two distinct interfaces:

**Human Interface**

A pen-first whiteboard accessed through a browser on an iPad or another drawing-capable device.

**Agent Interface**

A Remote MCP Server through which compatible AI Clients can create problems, retrieve handwritten snapshots, and append feedback.

The application MUST NOT include its own LLM runtime or require a model API key.

Users continue using their existing ChatGPT, Claude, or other AI workflows.

### 1.1 Design philosophy

**Canvas is the product. Everything else supports the canvas.**

The application is not a chatbot, an AI tutoring platform, or a learning management system.

It must feel like a natural writing surface that happens to be accessible to AI Agents.

### 1.2 Generality

Although mathematical exercises are the primary use case, the data model and drawing interface MUST remain domain-independent.

The application should also support handwritten explanations, sketches, diagrams, and iterative design discussions.

Education-specific features must not become fundamental assumptions of the underlying architecture.

### 1.3 Explicit non-goals

- Built-in AI conversations
- Model selection or API-key management
- Automatic grading logic
- A separate follow-up/round system
- AI-generated learning analytics
- Multi-user collaboration in v1.0
- Full LMS functionality
- Automatic Agent wake-up or background review orchestration

---

# Part II — Design Specification

## 2. Overall Interface Architecture

The primary interface follows the approved **Board + Sticky Peek** design.

The application occupies the entire browser viewport.

The Canvas is the dominant visual element, with lightweight controls floating above it.

### 2.1 Main screen regions

| Region             | Position              | Responsibility                                     |
| ------------------ | --------------------- | -------------------------------------------------- |
| Canvas             | Full viewport         | Handwriting and drawing                            |
| Question Bar       | Top-left              | Current question, navigation, expanded question    |
| Review Control     | Top-right             | Latest feedback and review history                 |
| Ready Control      | Top-right             | Mark ready / Resume editing                        |
| Drawing Toolbar    | Opposite writing hand | Pen, eraser, colors, undo/redo, settings           |
| Persistence Status | Bottom, near toolbar  | Save and answer state                              |
| Problem Overview   | Contextual overlay    | Collection, set, category, and question navigation |

The interface MUST NOT introduce a permanent sidebar.

All secondary surfaces are contextual and dismissible.

### 2.2 Visual hierarchy

The design should have three interaction levels:

**Level 0 — Canvas**

The primary writing surface.

**Level 1 — Peek**

Compact, persistent controls providing orientation and immediate access.

**Level 2 — Expanded**

Contextual panels displaying complete questions, navigation, settings, or feedback.

The user should be able to move between these levels without leaving the Canvas.

---

## 3. Visual Design System

### 3.1 Style

Use a restrained, bright, paper-inspired visual language.

Characteristics:

- Warm off-white background
- Very subtle dotted grid
- Neutral floating surfaces
- Minimal borders and shadows
- Blue primary action color
- Semantic feedback colors
- Compact, consistent iconography
- Limited motion
- Comfortable mathematical typography

Avoid decorative gradients, glassmorphism, oversized controls, and dashboard-style layouts.

### 3.2 Reference color tokens

The latest POC provides the following palette:

| Token             | Reference |
| ----------------- | --------- |
| Canvas background | `#FAFAF8` |
| Surface           | `#FFFFFF` |
| Primary text      | `#17191C` |
| Secondary text    | `#5F6670` |
| Border            | `#E3E3DE` |
| Primary accent    | `#2B59C3` |
| Correct           | `#1E7A55` |
| Partial           | `#A15C00` |
| Incorrect         | `#B93A26` |
| Neutral tile      | `#F1F1EC` |

These are reference design tokens. Minor adjustments for contrast and hardware rendering are allowed.

### 3.3 Typography

- Interface: Inter or a comparable system sans-serif.
- Mathematical content: STIX Two Text or a similar serif font.
- Formula rendering: MathJax or an equivalent robust LaTeX renderer.
- Status numerals: tabular numerals where appropriate.

Mathematical equations MUST remain readable and must not be silently truncated.

Long formulas may horizontally scroll within their container.

### 3.4 Controls

Interactive controls SHOULD provide approximately 44 × 44 pt effective touch targets on iPad.

The latest POC scales some interface elements to 75% of their CSS size. Production implementation MUST NOT rely on this scaling if it results in undersized touch targets.

Use semantic buttons, accessible labels, visible focus states, and meaningful disabled states.

### 3.5 Responsive behavior

**Primary:** iPad landscape  
**Secondary:** iPad portrait  
**Additional:** Desktop browser

Landscape:

- Vertical floating toolbar near the non-writing edge.
- Question Bar at top-left.
- Ready and Review controls at top-right.
- Contextual panels positioned near their triggers.

Portrait:

- Drawing toolbar may become horizontal near the bottom.
- Question Bar compresses its breadcrumb text.
- Expanded panels adapt to available screen dimensions.
- Controls must respect device safe areas.

Desktop:

- Preserve the same interaction model.
- Support mouse and keyboard shortcuts.
- Do not introduce a substantially different information architecture.

---

## 4. Canvas Specification

### 4.1 Drawing model

The Canvas MUST provide:

- Freehand drawing
- Erasing
- Multiple ink colors
- Undo and redo
- Pan and zoom
- Persistent vector-based drawing data
- Read-only mode
- Full-content image export

The latest POC uses four colors:

- Black
- Blue
- Red
- Green

These form the default v1.0 palette.

Pen thickness and advanced drawing tools MAY be added later, but are not required for the initial release.

### 4.2 Input model

When pen input is available:

- Apple Pencil/stylus SHOULD draw.
- Finger gestures SHOULD support canvas navigation.
- Accidental palm touches SHOULD NOT create strokes.
- Active writing must never be interrupted by UI re-rendering.

Mouse interactions:

- Primary button draws.
- Supported pan gestures move the Canvas.
- Keyboard shortcuts provide convenient desktop controls.

### 4.3 Gestures

Preserve the interaction concepts demonstrated by the POC:

- Pinch: Zoom.
- Touch pan: Move Canvas.
- Pen mode (a Writing setting, on by default, remembered per device): only the stylus or a mouse writes; one finger pans.

Undo and Redo are the rail buttons and keyboard shortcuts; there are no multi-finger tap gestures.

The gesture recognizer must not break ordinary native zooming and panning.

### 4.4 Writing preferences

Settings MUST support:

- Right-handed / Left-handed mode
- Eraser stays active after use
- Automatic question unfolding when off-screen

The toolbar SHOULD move to the opposite side of the dominant writing hand.

Preferences persist across sessions.

### 4.5 Locked Canvas

When the answer is Ready for Review:

- Drawing is disabled.
- Erasing is disabled.
- Undo and redo are disabled.
- Existing strokes remain visible.
- Pan and zoom remain enabled.
- Question navigation remains enabled.
- Review and settings remain accessible.

If the user attempts to draw, display a brief, non-blocking explanation:

_Ready for Review. Resume editing to make changes._

The interface must not silently discard an attempted interaction without indicating why editing is unavailable.

---

## 5. Question Presentation

### 5.1 Question on Canvas

The question initially appears as a paper-like tile positioned near the beginning of the writing area.

It contains:

- Question number
- Question title
- Full problem statement
- Mathematical expressions
- Optional figures

The question tile belongs to the Canvas coordinate system.

It moves and scales with the Canvas.

The handwriting area extends naturally beneath and around the question.

### 5.2 Sticky Peek

The Question Bar remains fixed to the viewport.

It displays:

- Problem set context
- Current question number and title
- Previous and next controls
- Problem Overview entry point

Tapping the question title expands the full problem statement within the Question Bar.

The expanded question is a viewport overlay, not another independent Canvas object.

### 5.3 Automatic unfolding

The POC implements a useful visibility-based mechanism that should be preserved.

Recommended thresholds:

- Unfold when less than 25% of the question tile is visible.
- Fold automatically when at least 40% becomes visible again.

The difference provides hysteresis, preventing flickering near the threshold.

Visibility SHOULD be measured using the question tile's actual on-screen geometry, rather than estimating visibility solely from camera coordinates.

Additional rules:

- Automatic unfolding is configurable.
- Manual dismissal must be respected.
- If the user manually dismisses the automatically opened question, it should remain dismissed until the original tile becomes visible again.
- Automatic unfolding MUST NOT interrupt an active pen stroke.
- Opening the Problem Overview must not trigger competing question overlays.

### 5.4 Mathematical rendering

The renderer MUST support common LaTeX notation, fractions, matrices, summations, alignments, and longer derivations.

Question content is untrusted external input and must be safely rendered.

Do not directly inject arbitrary HTML or SVG from MCP arguments into the DOM.

---

## 6. Problem Navigation

### 6.1 Organization

Use a lightweight hierarchy:

**Collection → Problem Set → Batch → Problem**

A Collection represents a course or broader topic.

A Problem Set represents a week or unit; one set per week.

A batch (the problem's optional `type`) groups a set's problems by kind of exercise. Problems are numbered within their batch.

The problem title is its topic.

Examples:

- Collection: CSC2516
- Set: Week 8
- Batch: Prediction
- Problem: Scaled dot-product attention

The title bar shows all three levels; each opens the Overview at that level (the collection menu, the set, the batch's section), and the question unfolds its statement.

This structure is for organization only. It must not evolve into an LMS.

### 6.2 Quick navigation

The Question Bar provides previous/next navigation within the current Problem Set.

Switching questions MUST preserve each problem's Canvas, camera state, and answer state.

No confirmation is needed when switching away from an autosaved draft.

### 6.3 Problem Overview

The contextual Overview contains:

- Collection selector
- Problem Set selector
- Question categories
- Numbered status tiles
- A concise state legend

The Overview should be scrollable, responsive, and dismissible.

Selecting a problem navigates to its Canvas and closes the Overview.

### 6.4 Incoming problems

When an Agent creates new problems:

- Add them to the appropriate Collection and Set.
- Do not automatically navigate away from the current Canvas.
- Show a restrained new-content indicator.
- Preserve the user's active drawing and scroll/zoom position.

New content must never steal focus during handwriting.

---

## 7. Review Interface

### 7.1 Compact view

When feedback exists, show a compact Review control near the Ready control.

It may display:

- Feedback icon
- Latest verdict symbol
- Appropriate semantic color

If feedback only belongs to an older Snapshot, the control MUST indicate that it is historical rather than a verdict for the current submission.

### 7.2 Expanded view

Opening Review reveals a contextual card with:

- Verdict, if supplied
- Explanation text
- Optional mathematical callouts
- Snapshot number
- Review timestamp
- Warning when the feedback applies to an older Snapshot
- Feedback history, when more than one entry exists

The existing POC's compact-to-expanded card behavior should be retained.

The review card must not permanently occupy Canvas space.

### 7.3 Mathematical callouts

Feedback may contain structured mathematical callouts such as:

- A correct step
- A missing term
- An incorrect derivation
- A suggested correction

Callouts should remain readable, including when formulas exceed the card width.

### 7.4 Feedback history

Feedback is append-only.

The UI MUST support multiple feedback entries per problem and multiple entries for the same Snapshot.

Default selection order:

1. Latest feedback on the latest Snapshot, if available.
2. Otherwise, latest feedback on an earlier Snapshot, clearly labeled as historical.

The user should be able to inspect older entries without navigating to a separate page.

Historical feedback is never deleted when a newer answer is submitted.

---

# Part III — Behavior Specification

## 8. Core Interaction Model

**One Problem → One persistent Canvas → Multiple immutable Snapshots → Append-only Feedback**

There are no Follow-up entities, Round entities, or separate canvases for revised answers.

Users may add corrections using different colors or additional writing space on the same Canvas.

The Agent is responsible for interpreting the handwriting, changes, and conversational context.

The application must not attempt to infer what constitutes a correction or a follow-up.

---

## 9. Answer State Machine

Each Problem has two principal answer states.

### Working

- Canvas is editable.
- Draft changes are autosaved.
- Existing Snapshots remain accessible to the backend.
- Main action: `Mark ready`.

### Ready for Review

- A committed Snapshot exists.
- Canvas is locked.
- Agent can retrieve the latest committed Snapshot.
- Main action: `Resume editing`.

**Ready for Review means the answer is available to an Agent. It does not mean an Agent is currently reviewing it.**

### 9.1 State transitions

| Current state    | Action                          | New state        | Result                                                      |
| ---------------- | ------------------------------- | ---------------- | ----------------------------------------------------------- |
| New / Working    | Draw                            | Working          | Draft modified and scheduled for save                       |
| Working          | Mark ready                      | Ready for Review | Save snapshot; lock Canvas                                  |
| Ready for Review | Resume editing                  | Working          | Unlock same Canvas                                          |
| Working          | Mark ready after modification   | Ready for Review | Create new Snapshot                                         |
| Working          | Mark ready without modification | Ready for Review | Reuse identical previous Snapshot                           |
| Ready for Review | Agent appends feedback          | Ready for Review | Add feedback entry; keep Canvas locked                      |
| Working          | Agent appends feedback          | Working          | Preserve current edits; add feedback to referenced Snapshot |

Mark ready MUST NOT create a duplicate Snapshot when there has been no content change since the latest committed Snapshot.

This preserves the idempotent behavior present in the latest POC.

### 9.2 Empty Canvas

Mark ready is disabled when the current Canvas contains no drawable answer content and no existing reusable Snapshot.

### 9.3 Snapshot failure

If snapshot generation or durable persistence fails:

- Remain in Working state.
- Preserve all local drawing data.
- Do not announce successful submission.
- Offer a recoverable retry path.

The UI may only display Ready for Review after backend confirmation.

---

## 10. Snapshot Semantics

### 10.1 Identity

Each Snapshot has:

- Stable Snapshot ID
- Parent Problem ID
- Monotonic sequence number
- Creation timestamp
- Immutable rendered image
- Source Canvas revision/fingerprint

Snapshot ordering is strictly defined **within each Problem**.

Example:

`problem_abc / snapshot_000001`  
`problem_abc / snapshot_000002`  
`problem_abc / snapshot_000003`

The backend MUST assign sequence numbers atomically.

Client timestamps are not authoritative for ordering.

### 10.2 Immutability

Once committed:

- Snapshot image cannot change.
- Snapshot ID cannot change.
- Snapshot sequence cannot change.
- Feedback references cannot be redirected.

The live Canvas may be modified after Resume editing, but previously committed Snapshots remain intact.

### 10.3 Latest Snapshot rule

**The Agent always receives the latest committed Snapshot.**

`get_submission(problem_id)` must select the highest committed Snapshot sequence.

The LLM must not be responsible for comparing Snapshot IDs or deciding which version is newest.

### 10.4 Working while a Snapshot exists

When the user resumes editing, the previous Snapshot remains available.

The Agent may still retrieve it, but the response MUST indicate:

- Current answer state: Working
- Latest committed Snapshot ID
- Whether the live draft has changes after that Snapshot

The Agent must not mistake the in-progress draft for the submitted image.

### 10.5 Image content

Snapshots MUST represent the complete relevant drawing content, not merely the currently visible viewport.

The exported image SHOULD:

- Use a white background.
- Include all drawing strokes.
- Preserve meaningful pen colors.
- Include adequate padding.
- Maintain sufficient resolution for mathematical handwriting recognition.
- Be reasonably cropped to the drawing bounds.

The question statement should be returned separately as structured context.

---

## 11. Feedback Semantics

### 11.1 Append-only

Every feedback entry is an immutable record referencing a specific Snapshot ID.

The application MUST support multiple feedback entries per Snapshot.

Do not replace previous feedback when an Agent submits a new response.

### 11.2 Verdict

A feedback entry MAY include one of:

- `correct`
- `partial`
- `incorrect`

Verdict is optional so that the Agent can provide comments without grading the answer.

No model-independent correctness evaluator is required.

### 11.3 Reference integrity

`append_feedback` MUST require an explicit Snapshot ID.

Do not automatically bind incoming feedback to whichever Snapshot is newest at write time.

This prevents delayed Agent responses from accidentally attaching to a newer version.

Feedback on older Snapshots remains valid historical information.

### 11.4 Multiple feedback entries for one Snapshot

When multiple graded feedback entries target the same Snapshot, the latest graded entry is the displayed effective verdict for that Snapshot.

All preceding entries remain preserved.

This does not count as improvement or regression because the handwriting itself did not change.

### 11.5 New Snapshot without feedback

When a new Snapshot has no feedback:

- The current answer state is Ready for Review.
- Previous feedback must not be presented as the current version's verdict.
- Historical feedback remains accessible.

---

## 12. Status Tiles and Progress Semantics

The Overview communicates two kinds of information:

**Primary appearance:** Current answer/review status.

**Corner badge:** Review outcome or change between reviewed Snapshots.

### 12.1 Primary tile state

| Current condition                     | Tile appearance        |
| ------------------------------------- | ---------------------- |
| No handwriting                        | Neutral / empty        |
| Editing                               | Outlined working state |
| Latest Snapshot ready but unreviewed  | Blue Ready for Review  |
| Latest Snapshot reviewed as Correct   | Green                  |
| Latest Snapshot reviewed as Partial   | Amber                  |
| Latest Snapshot reviewed as Incorrect | Red                    |

If the Canvas has been reopened for editing, the active tile should communicate Working, not falsely imply the current draft has been graded.

The latest historical verdict can be shown separately.

### 12.2 Trend badge

Compare the effective verdicts of the two latest **distinct reviewed Snapshots**.

Ordering:

`incorrect < partial < correct`

- `↗`: Improvement
- `↘`: Regression
- `✓`: Correct without an improvement/regression transition
- `½`: Partial without a transition
- `✕`: Incorrect without a transition

Multiple reviews of the same Snapshot MUST NOT produce a progress trend.

### 12.3 Preserve first attempt information

Initial correctness must remain recoverable from Snapshot/Feedback history.

Do not overwrite the first review when a user eventually obtains a Correct verdict.

The UI may show the initial and latest reviewed outcomes in an expanded detail view, but a permanent dual-grade display is not required.

### 12.4 Navigation selection

Selected Question is independent of answer state.

Use a distinct outer outline or selection ring.

Newly received questions may use a separate small notification dot.

---

## 13. Autosave and Restoration

### 13.1 Draft persistence

Changes to drawing content MUST be persisted independently of Mark ready.

A user should not have to submit their answer to avoid losing work.

Persistence should be debounced and should not interrupt an active stroke.

### 13.2 Save status

Display accurate states such as:

- Saving…
- Saved
- Connection unavailable
- Save failed

Never display Saved before the corresponding persistence operation is acknowledged.

### 13.3 Recovery

On reload, restore:

- Active Problem
- Drawing content
- Answer state
- Selected color and tool preferences
- Relevant per-problem camera positions
- Available feedback history

### 13.4 Offline or network failure

Local recovery storage SHOULD protect unsaved handwriting against temporary connectivity failure.

A disconnected user may continue drawing if a local recovery mechanism is available.

However, Mark ready must not claim that the Snapshot is available to an Agent until the server confirms the commit.

---

# Part IV — Technical Specification

## 14. Selected Architecture

Use a single Cloudflare-hosted application.

**Frontend**

React + TypeScript + Vite, with the pinned tldraw canvas engine. Account pages and the product entry belong to one client-rendered React SPA; Hono serves page shells and APIs; Cloudflare Static Assets serves public assets directly.

**Backend**

One Cloudflare Worker, with Hono Browser API routes, SDK-managed OAuth and a hand-rolled stateless MCP endpoint.

**Structured Storage**

Cloudflare D1.

**Snapshot Storage**

Private Cloudflare R2, with D1 holding the authoritative committed object pointers.

**Agent Interface**

Remote MCP Server using Streamable HTTP.

### 14.1 Service boundaries

Organize the application into four logical layers:

1. **Presentation:** Canvas, Question Bar, Overview, Review, Settings.
2. **Application Services:** Problem management, Canvas persistence, Snapshot commit, Feedback append.
3. **Persistence:** Database and object storage.
4. **Transport Adapters:** Browser HTTP API and MCP Server.

The MCP adapter and browser API MUST call the same application services.

MCP tools should not implement independent business logic or interact directly with frontend state.

### 14.2 Deployment endpoints

Product routes:

- `/` and `/app` — authenticated Web application
- `/api/*` — Browser application API
- `/mcp` — Remote MCP endpoint

### 14.3 Canvas engine

The POC uses tldraw 3.15.6.

The selected implementation pins tldraw 3.15.6 and preserves its native watermark. Engine upgrades require a deliberate compatibility and licensing review.

The engine must satisfy the required drawing, gesture, persistence, read-only, and export behaviors.

Audit all third-party licensing requirements before publishing the self-hosted release.

Do not develop a custom drawing engine unless established libraries cannot meet essential requirements.

---

## 15. Canonical Data Model

The production schema should represent the following entities.

### Collection

| Field        | Purpose                  |
| ------------ | ------------------------ |
| `id`         | Stable unique identifier |
| `title`      | Display title            |
| `created_at` | Creation time            |

### ProblemSet

| Field           | Purpose                  |
| --------------- | ------------------------ |
| `id`            | Stable unique identifier |
| `collection_id` | Parent Collection        |
| `title`         | Display title            |
| `sort_order`    | Navigation ordering      |
| `created_at`    | Creation time            |

### Problem

| Field                       | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `id`                        | Stable unique identifier                   |
| `set_id`                    | Parent Problem Set                         |
| `title`                     | Question title                             |
| `body`                      | Problem statement, including math notation |
| `type`                      | Optional batch                             |
| `sort_order`                | Position in set                            |
| `answer_state`              | `working` or `ready_for_review`            |
| `latest_snapshot_seq`       | Latest committed Snapshot sequence         |
| `canvas_revision`           | Live drawing revision                      |
| `created_at` / `updated_at` | Timestamps                                 |

### CanvasDocument

| Field                      | Purpose                             |
| -------------------------- | ----------------------------------- |
| `problem_id`               | Owner Problem                       |
| `document` or `object_key` | Serialized vector drawing data      |
| `revision`                 | Optimistic concurrency revision     |
| `fingerprint`              | Browser-computed answer fingerprint |
| `updated_at`               | Last durable update                 |

There is exactly one logical live Canvas per Problem.

### Snapshot

| Field             | Purpose                            |
| ----------------- | ---------------------------------- |
| `id`              | Stable, sortable Snapshot ID       |
| `problem_id`      | Parent Problem                     |
| `sequence`        | Monotonic per-problem number       |
| `image_key`       | Immutable object-storage reference |
| `source_revision` | Canvas revision captured           |
| `content_hash`    | Optional duplicate detection       |
| `created_at`      | Commit timestamp                   |

Unique constraint:

`(problem_id, sequence)`

### Feedback

| Field         | Purpose                          |
| ------------- | -------------------------------- |
| `id`          | Stable unique ID                 |
| `problem_id`  | Parent Problem                   |
| `snapshot_id` | Exact reviewed Snapshot          |
| `verdict`     | Optional correctness verdict     |
| `text`        | Feedback content                 |
| `callouts`    | Optional structured explanations |
| `created_at`  | Timestamp                        |

Feedback records must be append-only.

### 15.1 Derived information

Do not permanently store redundant fields such as:

- First verdict
- Latest effective verdict
- Improvement/regression trend
- Current tile color
- Number of reviewed attempts

These values should be derived from ordered Snapshot and Feedback records.

Caches are acceptable if they can be rebuilt from canonical data.

---

## 16. MCP Contract

Implement four core tools.

### 16.1 `create_problems`

Creates one or more problems.

Input SHOULD support:

- Collection or Set destination
- Problem titles
- Problem bodies
- Optional categories
- Optional images/figures, using a safe supported representation
- Stable external request identifier for idempotency

Behavior:

- Create new problems without overwriting existing ones.
- Preserve problem ordering.
- Do not change the user's currently selected problem.
- Return created Problem IDs.

### 16.2 `list_problems`

Lists available problems and their status.

Optional filters:

- Collection
- Problem Set
- Status

Return:

- Problem IDs and titles
- Collection/Set metadata
- Answer state
- Latest committed Snapshot ID
- Latest Snapshot review status
- Relevant progress summary

Avoid returning all handwriting images in list responses.

### 16.3 `get_submission`

Input:

`problem_id`

Behavior:

- Resolve the latest committed Snapshot on the server.
- Never return a live, unfinished draft as the submitted answer.
- Return the Snapshot image as an MCP-compatible image content block.
- Return structured question and Snapshot metadata.

Metadata MUST include:

- `problem_id`
- `snapshot_id`
- `sequence`
- `created_at`
- `answer_state`
- `has_unsubmitted_changes`

When no Snapshot exists, return a structured Not Ready result rather than an unrelated image.

The default contract always retrieves the latest committed version. Historical image retrieval is not required for the initial MCP surface.

### 16.4 `append_feedback`

Input:

- `problem_id`
- `snapshot_id`
- `feedback`
- Optional `verdict`
- Optional structured `callouts`
- Optional idempotency key

Behavior:

- Verify that the Snapshot belongs to the specified Problem.
- Append a new Feedback record.
- Never overwrite existing entries.
- Accept feedback for historical Snapshots.
- Return the new Feedback ID.

Repeated delivery with the same idempotency key should not create unintended duplicate entries.

### 16.5 No Follow-up tool

Do not implement `append_follow_up`.

A user continues on the existing Canvas, creates a newer Snapshot, and the Agent retrieves it through `get_submission`.

Follow-up interpretation belongs to the AI conversation, not to whiteboard state management.

---

## 17. Browser API Contract

Implement browser-facing API operations for:

- Listing Collections and Problem Sets
- Listing and selecting Problems
- Reading a Problem and its Canvas
- Saving Canvas revisions
- Marking an answer Ready
- Resuming editing
- Retrieving status and feedback history
- Reading user preferences

The exact REST path structure is an implementation detail, but the semantics must match the application and MCP contracts.

### 17.1 Atomic Snapshot commit

Mark ready requires a coordinated operation:

1. Capture the current Canvas revision.
2. Generate the complete answer image.
3. Ensure the source drawing revision is durably saved.
4. Store the immutable image.
5. Atomically allocate the next Snapshot sequence and commit its metadata.
6. Set the answer state to Ready for Review.
7. Return the committed Snapshot ID.

If image storage succeeds but database commit fails, the backend must not report success. Orphaned objects should be recoverable or cleaned up.

Concurrent Mark ready requests must not create duplicate sequence numbers.

### 17.2 Save concurrency

Canvas writes SHOULD use revision-based optimistic concurrency control.

A stale client must not silently overwrite a newer Canvas revision.

The frontend must preserve recoverable local data if a conflict occurs.

### 17.3 Read-only enforcement

Ready for Review is not merely a UI flag.

The backend MUST reject ordinary Canvas modifications while the corresponding Problem is in the Ready state, unless the user has explicitly resumed editing.

This prevents stale clients from modifying a locked answer.

---

## 18. Security and Privacy

Each deployment is intended to be independently owned.

### 18.1 Authentication

Browser access and MCP access MUST be protected.

Use session-based browser authentication and an MCP-compatible authentication mechanism supported by the target clients.

Do not expose unauthenticated remote write tools.

### 18.2 Authorization

Every MCP operation must be authorized against the current instance/workspace.

Possession of a predictable Problem or Snapshot ID must not automatically grant access.

### 18.3 Private storage

Snapshot objects should not be publicly enumerable.

Prefer private R2 objects accessed through authenticated backend routes or short-lived access links when required.

### 18.4 Untrusted content

Problem statements and Agent feedback are externally supplied data.

The application must sanitize rendered rich text, enforce supported formats, and avoid executing embedded scripts or untrusted HTML/SVG.

### 18.5 Operational safeguards

Include reasonable limits for:

- Request size
- Image size
- Batch problem creation
- Tool invocation frequency
- Storage usage

---

## 19. Performance and Reliability

### 19.1 Drawing performance

Active pen interaction is the highest-priority frontend operation.

- Avoid unnecessary React re-renders during strokes.
- Avoid blocking input on network requests.
- Debounce serialization and durable sync.
- Preserve fluid camera movement.
- Defer nonessential UI updates until a stroke ends.

### 19.2 Rendering

Mathematical rendering should not repeatedly reprocess unchanged expressions.

Long formulas and rich feedback must not unexpectedly resize or obstruct the active Canvas during writing.

### 19.3 Synchronization

The selected architecture uses a notification-only ChangeHub Durable Object and WebSocket, with a change-counter catch-up and bounded long-poll fallback. Notifications never carry canvas content and do not establish persistence success. See [Architecture](architecture.md).

The current user interaction must remain uninterrupted when remote changes are detected.

### 19.4 Export quality

Snapshot export must be tested against dense handwriting, large derivations, and multiple colors.

The exported image should be useful to vision-language models without requiring the user to manually crop screenshots.

### 19.5 Data portability

Users SHOULD be able to export their structured problems, Canvas documents, Snapshots, and Feedback.

The application must not make user data dependent on an active ChatGPT or Claude subscription.

---

# Part V — Acceptance Specification

## 20. Functional Acceptance Tests

| ID  | Test                              | Expected result                        |
| --- | --------------------------------- | -------------------------------------- |
| F01 | Draw with Apple Pencil            | Smooth, accurate handwriting           |
| F02 | Pan/zoom with fingers             | Navigation without unwanted strokes    |
| F03 | Switch between problems           | Each Canvas preserved                  |
| F04 | Reload application                | Draft and selected state restored      |
| F05 | Mark ready                        | Snapshot committed, Canvas locked      |
| F06 | Attempt drawing while locked      | No modifications; brief explanation    |
| F07 | Resume editing                    | Same Canvas becomes editable           |
| F08 | Mark ready after edits            | New Snapshot sequence allocated        |
| F09 | Mark ready without edits          | Previous identical Snapshot reused     |
| F10 | Agent calls get_submission        | Latest committed image returned        |
| F11 | Agent appends Feedback            | New Feedback linked to exact Snapshot  |
| F12 | Multiple Feedback on one Snapshot | All entries retained                   |
| F13 | Older Feedback arrives late       | Stored against older Snapshot          |
| F14 | New Snapshot awaits review        | UI shows Ready, not stale Correct      |
| F15 | Incorrect → Correct               | Green latest result, improvement badge |
| F16 | Correct → Incorrect               | Red latest result, regression badge    |
| F17 | Agent creates new problems        | New indicator; active Canvas unchanged |
| F18 | Save fails                        | User informed; work not silently lost  |
| F19 | Network disconnected              | No false Ready or Saved confirmation   |
| F20 | Unauthorized MCP call             | Request rejected                       |

## 21. UX Acceptance Tests

Test on a real iPad whenever possible.

**Writing session**

Write continuously for at least ten minutes. Evaluate latency, palm rejection, toolbar placement, and accidental activation.

**Long derivation**

Create a solution spanning several screen heights. Verify the Sticky Peek and automatic question unfolding behavior.

**Question navigation**

Switch among at least six questions, including completed, incomplete, and reviewed ones.

**Review workflow**

Open a mathematical feedback explanation while viewing handwriting. Check formula overflow and panel obstruction.

**Iterative correction**

Create Snapshot #1, receive Partial feedback, resume editing, correct the original Canvas, create Snapshot #2, and receive Correct feedback.

Verify that both Snapshot and Feedback histories remain intact.

**Concurrent Agent activity**

Create additional problems or append feedback while the user is drawing. Verify that drawing is never interrupted.

**Responsive behavior**

Verify portrait, landscape, and reduced-size tablet viewports.

---

# Part VI — Implementation Instructions

## 22. Engineering Guidance

Build the production application from scratch.

The provided POC should be treated as a source of:

- Visual design tokens
- Approved layout and information hierarchy
- Validated interaction behavior
- Example mathematical content
- Demonstration of state transitions
- Reference gestures and UI states

Do not mechanically port the compiled JavaScript, localStorage persistence, mock Agent simulation, or monolithic rendering code.

### 22.1 POC versus production distinctions

| POC behavior                                             | Production requirement                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| Browser localStorage persistence                         | Durable user-owned storage                      |
| Random Snapshot IDs                                      | Backend-assigned sortable sequence              |
| Simulated feedback                                       | Real MCP write operation                        |
| Automatic simulated review                               | Removed from normal product behavior            |
| Seeded handwriting and canned problems                   | Optional demo fixtures only                     |
| Single bundled HTML                                      | Maintainable source project                     |
| Prototype Agent inspection panel                         | Development-only diagnostic                     |
| Last-reviewed color may persist on newer unreviewed work | Current submission state takes precedence       |
| Simulated review may skip an already reviewed Snapshot   | Multiple append-only Feedback entries supported |

### 22.2 Architecture flexibility

The coding Agent may choose the most appropriate component structure, state management library, testing tools, and deployment setup.

However, it must not change:

- Core product positioning
- Main UI hierarchy
- Answer state semantics
- One-Canvas-per-Problem rule
- Snapshot identity and ordering
- Append-only Feedback
- MCP contract
- Self-hosted ownership model

### 22.3 Scope discipline

Do not add functionality merely because it is easy to generate.

Prefer a reliable, polished implementation of the frozen interaction model over additional features.

The application must remain lightweight enough to serve as a small, maintainable open-source utility.

---

## 23. Production Completion Criteria

The production release is complete when:

1. A user can deploy their own instance to Cloudflare.
2. The user can connect a compatible external AI Client.
3. The Agent can create problems without controlling the browser UI.
4. The user can open the whiteboard on iPad and write naturally.
5. Draft work is safely persisted.
6. The user can Mark ready and create a committed Snapshot.
7. The Agent can retrieve the latest committed handwritten image.
8. The Agent can append Feedback referencing the exact Snapshot.
9. The user can resume editing and produce an updated Snapshot.
10. The interface preserves the full review history and reflects the latest answer state correctly.

The release must clearly document client-specific MCP limitations and supported authentication methods.

---

## 24. Final Design Contract

**InkLoop is an interaction peripheral for AI Agents, not a replacement AI application.**

The Human Interface provides a natural writing surface.

The Agent Interface provides reliable access to committed handwritten state.

The backend manages durable data, immutable Snapshots, and append-only Feedback.

The Agent owns reasoning, interpretation, and conversation context.

The user owns the whiteboard, the deployment, and the data.

**One Problem. One Canvas. Many Snapshots. Append-only Feedback.**

_Give your AI a whiteboard._
