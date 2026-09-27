# Roamgate: reference notes (2026-09-25)

https://github.com/powerfooI/roamgate. MIT licence, Bun/TypeScript bridge with a React + xterm web client for Herdr.

**How we use it:** a source of ideas and reference implementations. We build our own features in HuntHub. It is not a dependency, and it doesn't run inside HuntHub. If we copy code, keep the MIT notice.

Architecture: Browser ⇄ WebSocket ⇄ Bun bridge ⇄ `herdr.sock` (NDJSON) + `herdr-client.sock` (binary terminal protocol).
The Herdr plugin is only a launcher; the bridge runs as a user service.

## Ideas to borrow (and where to look)
- **Native terminal streaming:** speaks Herdr 0.9 "endpoint generation 1" codecs (`shell.snapshot.v1`, `shell.surface.v1`, `shell.input.semantic.v1`, `shell.blob.v1`).
  - Allowlist check; unknown versions are refused.
  - Each viewer crops its pane from the shared tab surface.
  - Delta/reuse baselines; WebSocket compression for messages ≥1 KiB.
  - Sources: `docs/ARCHITECTURE.md` ("Terminal endpoints"), `server/src/herdr`, `server/src/bridge`.
  - HuntHub plan: start by spawning `herdr terminal session observe/control`, then move to native using this as the guide.
- **Agent history from transcripts:** reads Claude/Codex/Pi/Kimi… session files via the session path the Herdr integration reports.
  - User/agent/tool filters, timeline, ATIF export.
  - Incremental `snapshot`/`delta` protocol with cursor `{epoch, revision}` and a 200-entry window.
  - Sources: `docs/HISTORY.md`, `server/src/agent`.
  - HuntHub use: **structured tool-call history for provenance, audit and evidence.**
- **Task notifications:** a passive endpoint shell (`surface_active:false`) receives Herdr's `SemanticNotification` (finished / needs-attention).
  - Falls back to status-transition tracking (per-pane subscriptions plus reconcile).
  - Relayed to Web Push (VAPID).
  - Source: `docs/ARCHITECTURE.md` ("Task notifications"), `server/src/notifications`.
- **Connection isolation:** a `ConnectionManager` with per-connection runtimes, generations and request leases. Stale results can never publish.
  - Useful for a runner managing several Herdr sessions.
- **Subscribe then snapshot:** a subscription ack triggers a snapshot, and events during a refresh queue another refresh (reconcile rather than replay).
- **Agent activity ordering:** `last_activity_at` from the transcript file's mtime, then Herdr's state-change sequence.
- **Integrations management:** `integration.list` plus a same-host `herdr integration status` fallback, with a version-match check.
- **Files / diffs / worktrees:** file explorer with realpath escape checks; diff views (working tree / against main / "last step" snapshot at active→idle boundaries); worktree lifecycle.
- **Review annotations:** comment on diffs or terminal text, then **pre-fill** the agent's input. It's never auto-submitted.
- **Mobile/PWA:** terminal shortcut grid and a composer (Insert vs Send).

## Things to avoid (its trust model is single-user)
- Loopback connections skip login.
- No Origin or Host checks.
- Stateless cookies that can't be revoked.
- "UI access = full authority."

HuntHub owns multi-user auth, roles and audit.

## Agent handling (added 2026-09-27, main d094413)
- **No launch or prompt API use:** it never calls `agent.start` or `agent.prompt`. The composer types into the terminal (Insert, or Send = + Enter), and review feedback pre-fills with `pane.send_text` without submitting (`web/src/annotations.ts`, `web/src/store.ts`).
- **Transcripts** (`server/src/agent/session-resolver.ts`):
  - A reported path is read directly.
  - An id is searched on disk: `~/.claude/projects/**/<id>.jsonl`, `~/.codex/sessions/**`, Kimi and Pi folders.
  - Otherwise it takes the newest session in the pane's folder.
  - Seven per-agent parsers produce ATIF trajectories (`session-trajectory.ts`, about 1100 lines).
  - It re-reads whole files and keeps a 200-entry window.
  - Remote (SSH) lookups by id don't work, so Claude and Codex history is likely local-only.
- **Tokens:** normalized from transcripts (`token-usage.ts`); no costs.
- **"What changed" diffs** come from git, including a private-index snapshot at each active→idle boundary (`server/src/workspace/git-snapshot.ts`), not from tool calls.
- **No approval UI:** blocked is a badge, and you answer in the terminal.
