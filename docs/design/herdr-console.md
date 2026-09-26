# Herdr console: design (draft, 2026-09-26)

HuntHub becomes a full remote console for Herdr on many machines: session lifecycle, layout, live terminals and agents. Hunting features are built on top.

This design comes from studying Herdr's source (v0.9.1) and Roamgate (MIT; a web client for Herdr, see `docs/research/roamgate.md`), then comparing both with what M1/M2 built.

## What stays
- **M1 is unchanged:** machines, the outbound runner, enrollment, stats and history, settings, the live browser channel.
- **The runner as a thin, allowlisted Herdr gateway (A2).** Roamgate's bridge works the same way: generic `herdr.call(method, params)` pass-through, with a few special-cased methods and one request per socket connection. That validates the model.
- **The hub interprets Herdr data** and keeps live state in memory. Herdr remains the source of truth.

## What changes

### 1. State sync: event-driven instead of 1 s polling
M2 polls `session.snapshot` every second, because agent state changes produce no general event. Roamgate solves this properly (`connections/agent-status-subscription.ts`):
- Per session, one **lifecycle subscription** (workspace/tab/pane/worktree events).
- Plus a **second subscription with one `pane.agent_status_changed{pane_id}` entry per pane that hosts an agent**.
- The set of agent panes comes from `pane.list`. It is rebuilt (debounced about 300 ms) on `pane_agent_detected`, `pane_closed`, `pane_moved`, `tab_closed` and `workspace_closed`, and re-checked every 30 s as a fallback.
- The runner still forwards **full snapshots** (simple and idempotent), but only when an event arrives, plus a slow reconcile every 30 s.

Result: status changes arrive instantly instead of within about 1 s, with far less local churn. The hub-side model doesn't change.

### 2. Gateway policy tiers instead of a fixed allowlist
The runner's allowlist becomes a **per-machine policy** that admins set in the hub and the hub sends to the runner:

| Tier | Allows |
|---|---|
| `read` | Everything M2 reads (the current allowlist) |
| `manage` | Plus session lifecycle, workspace/tab/pane create, rename, split and close, focus, and worktree create/open/remove |
| `agents` | Plus `agent.start/prompt/send_keys/rename`, `pane.send_input/send_keys` |
| `terminal` | Plus opening interactive terminal control, not just observing |

The runner enforces the policy locally, so the hub alone can't exceed it. Methods that never pass through, whatever the tier: plugin install, `integration.*` changes (handled by a dedicated flow), `server.live_handoff`, and `config` edits.

### 3. Session lifecycle is done by the runner, not the socket API
Starting a session means starting a process, which the socket API can't do. Findings from Herdr's source:
- **Names:** ASCII letters, digits, `.`, `_` and `-`, up to 64 bytes. The runner validates them the same way.
- **Stop:** `server.stop` over the session socket, then wait until the sockets disappear. This kills all panes in that session.
- **Delete:** only when the session is stopped. It removes `~/.config/herdr/sessions/<name>`, including saved layout and history. The `default` session can't be deleted.
- **Start:** Herdr's own UI starts a detached `herdr server` (setsid). Roamgate installs a systemd user service with `herdr server` for the default session.

Design:
- **Start:** the runner starts a session as a systemd user template unit `hunthub-herdr@<name>.service`:
  - `ExecStart=herdr server`
  - `Environment=HERDR_SESSION=%i`
  - `Restart=on-failure`, not `always`, so a clean `server.stop` isn't undone
  - raised `TasksMax`
  
  That gives logs, crash restarts, and survival across runner restarts and updates. If systemd user services aren't available, it falls back to a detached spawn, as Herdr does.
- **Stop:** `server.stop` over the socket. This works for any session, however it was started. If a HuntHub unit exists, the runner also stops it.
- **Delete:** the same rules as `herdr session delete`, done by running that command, and admin-only in the hub.
- Sessions started by you or Hermes stay first-class. The hub only needs their socket.

### 4. Terminals in two phases
- **Phase 1:** the runner spawns the machine's own `herdr terminal session observe|control` (NDJSON over stdio). That's small, and the versions always match because it uses the same binary. Frames are multiplexed over the runner WebSocket as **channels** (`term.open/term.frame/term.input/term.resize/term.close`, with a channel id), the hub relays them to browsers, and xterm.js renders them.
  - Many viewers can watch; one controller at a time, with explicit takeover.
  - Backpressure: drop a viewer that falls behind and send it a fresh full frame.
- **Phase 2 (only if needed):** Herdr's native **endpoint generation 1** protocol, which is frozen and stable. Roamgate implements it in roughly 4,500 lines (`bridge/endpoint-*`), MIT, and it can be used as the reference. It adds terminal clipboard (OSC 52), Herdr's `SemanticNotification` (Herdr's own finished / needs-attention signal, useful for M5), and bandwidth savings.

### 5. Mutation rules (Roamgate lessons)
- Create with `focus: false`, so remote actions never steal focus from you or Hermes, and return the created IDs.
- **Serialize mutations per session** on the runner, and give each a deadline. On timeout, report **"uncertain"** instead of retrying blindly; the UI re-reads state first.
- Never act on stale identities. Herdr IDs are per-server counters and change on `pane.move`. Every command carries the session name, and the runner re-checks that the target exists.
- Agents started by HuntHub get `HUNTHUB_RUN_ID` in the pane environment, so they keep a stable identity across Herdr restarts (M3c).

### 6. Audit
Every mutation through the hub is recorded: who did it, which machine, session and method, the parameters with secrets redacted, the result, and the time. That's the first persistent table for the console.

## Build order
1. **Sync redesign:** event-driven subscriptions and per-machine policy plumbing. No new UI.
2. **M3a, session and layout:** lifecycle (start, stop, delete), workspaces, tabs and panes, worktrees, plus the audit log.
3. **M3b, terminals:** observe, control and takeover (phase 1).
4. **M3c, agents:** start, prompt and stop; stable identity; adopting external agents.
5. **M3d, administration:** policy UI per machine, integrations view and install.

## Decisions (2026-09-26)
- **The machine and its Herdr are the source of truth.** Sessions, workspaces or panes created, changed or deleted directly on a machine (by the user, Hermes or anything else) must show up correctly in the hub.
  - The hub never keeps its own list of sessions or layout: it only shows what runners report, and after an action it waits for the machine's report instead of guessing.
  - The runner watches the Herdr folder for new or removed sessions (a filesystem watch plus a periodic scan).
  - The audit log records actions, never state.
- **Terminals: build both options**, the CLI observe/control approach and Herdr's native endpoint protocol (borrowing Roamgate's MIT code), selectable per terminal, so they can be compared in real use. One may be dropped later.
- Borrow from Roamgate (MIT, keep the notice) instead of re-implementing where it fits.
- **Keep it simple for now:** every signed-in user (admins and members) can do everything in the console. Roles and permissions come later, once the full hub is built.
- **Policy tiers:** not built yet. The runner allows the full console method set by default. The tier design above stays for later (M3d or the roles work).
- **Deleting sessions from the hub:** allowed for everyone, with a confirmation dialog, following Herdr's rules (stopped only, never `default`).

## Terminals as built (M3b, 2026-09-26)

Both transports are behind the same `term.*` channel protocol and are chosen per terminal in the UI (the choice is remembered per browser).

| | Herdr CLI (`cli`) | Native endpoint (`native`) |
|---|---|---|
| How | Runner spawns `herdr terminal session observe/control` | Runner speaks endpoint generation 1 on `herdr-client.sock` (Roamgate's client, vendored in `apps/runner/src/vendor/roamgate`, MIT) |
| Frames | Herdr's own ANSI (full + diffs) | Pane cropped from the tab surface, re-encoded as full ANSI each frame |
| Keystroke to screen (laptop test) | ~750-1000 ms | ~50 ms |
| Control | One controller per pane; others are refused until they take over (`--takeover`) | No lock: several viewers can type at once |
| Side effects | None while watching | Focuses the pane within its tab, even while watching |
| Version coupling | None (same binary) | Frozen protocol, Herdr >= 0.9.0 |

The hub checks the runner's `terminal:cli` / `terminal:native` capability, refuses other origins (cookies travel on cross-site WebSocket upgrades), never forwards keystrokes from a watching terminal, and audits each control session (`terminal.control`).

### Whole-session view

"Open session" on a session page shows the whole session in Herdr's own UI (tabs, splits, keybindings), as if it were opened in a terminal on the machine. The runner runs `herdr --session <name>` in a PTY (Bun's built-in `terminal` spawn option) and streams its output through the same `term.*` channels (`view: 'session'`, capability `terminal:session`). Closing it only ends that client; the session keeps running. Stopped sessions are refused so Herdr's client can't start a server outside the runner's lifecycle management. 
### Web layout (Roamgate style)

The same page has a second view, "Web layout": our own workspace/tab navigation, and the selected tab drawn as Herdr splits it (from `session.snapshot` `layouts`, normalised by the hub to fractions of the tab area), with one live pane terminal per pane through the chosen transport. Clicking a pane gives it the keyboard; a zoomed tab shows only its zoomed pane. The runner now treats split structure (directions, rounded ratios, zoom) as a reportable change, but not raw rects, which move whenever any client resizes.

Trade-offs to watch in real use: with the CLI transport every visible pane holds its control lock while controlling; with the native transport each pane is its own endpoint client, and Herdr's same-tab pane focus is shared between them.

## Agents as built (M3c, 2026-09-26)

Decided without a check-in (the user asked for the next stages to go ahead overnight); open to change.

- **Start (`hunthub.agent.launch`, runner):** a new tab in a space or a split beside a pane (with `HUNTHUB_RUN_ID` in the new shell's environment), then Herdr's `agent.start`, which types the agent's command into that shell (so it gets the user's PATH, env and folder). A fresh shell is retried until idle (up to 15 s); on failure the new pane is closed again. Creating and starting are queued with the session's other changes; waiting for a first prompt is not.
- **Only installed agents are offered:** the runner asks the user's login shell (`$SHELL -ilc 'command -v …'`, cached 5 min) which of the supported agent programs exist (`hunthub.agent.kinds`). Supported kinds are a curated subset of Herdr's (`AGENT_KINDS` in `packages/shared/src/console.ts`).
- **First prompt:** sent with `agent.prompt` only after the agent reports idle twice in a row (1 s apart). If it asks something first (e.g. Codex/Claude "trust this folder?", status blocked), the prompt is not sent and the UI says so: HuntHub never answers an agent's question on the user's behalf.
- **Prompting later:** a composer (Send = `agent.prompt`, which Herdr refuses while the agent asks something or isn't ready; then "type it into the pane anyway" = `pane.send_input` + Enter; Insert = typed without Enter). Drafts are kept per agent while the page is open.
- **Stop (`hunthub.agent.stop`, runner):** Herdr has no agent.stop. Ctrl+C twice per round, up to three rounds, until the pane no longer hosts an agent; if it still runs, the UI offers closing the pane.
- **Identity:** an agent's Herdr name (unique among live agents, kept across Herdr restarts) identifies it; `HUNTHUB_RUN_ID` is only in the environment while the shell lives (Herdr doesn't restore extra env).
- **Runs (`agent_run` table):** who started or adopted which agent (machine, session, Herdr name, kind, user, time). The hub marks matching live agents `origin: 'hunthub'` with `run {adopted, by, at}`; others stay `external`. A run ends when its agent is gone from a running session (after a 3 min grace for starting); stopped sessions don't end runs, since Herdr brings agents back by name.
- **Adopt:** an external agent becomes HuntHub's: if it has no Herdr name it gets one (`agent.rename`), and a run records who adopted it.
- **Console methods:** `agent.start/prompt/send_keys/rename` and `pane.send_input/send_keys` are allowed and audited like other changes (the audit no longer blanks `keys`, which are key names like Ctrl+C).
- **UI:** New agent dialog (sidebar Agents "+", space menu, Alt+Shift+A), agent menus (Go to, Send prompt…, Rename, Adopt, Stop) on agent rows and agent panes, Alt+Shift+P to prompt the agent in the focused pane, and "started/adopted by" under agents in the sidebar.
- **Testing rule:** never start an installed agent kind in tests (a PATH-shadowing fake still launched the real Codex once); use uninstalled kinds, mocked requests, or simulated agents (`pane.report_agent`).

## Administration as built (M3d, 2026-09-27)

Decided without a check-in, like M3c.

- **Console access per machine** (`machine.console_policy`, admins set it from the machine's ⋯ menu): Read only < Layout < Agents < Full (default). Each console method maps to the level it needs (`policyNeeded` in `packages/shared/src/console.ts`): reads and file browsing need Read; sessions, spaces, tabs, panes and worktrees need Layout; agents and integrations need Agents; typing into a terminal (`terminal.control`) needs Full.
- **Enforced twice:** the hub refuses (403, with a message naming the level) and the runner refuses on its own. The hub sends the level in `welcome` and a `policy` message when it changes; the runner closes its typing terminals when Full is taken away.
- **Machine cap:** `HUNTHUB_CONSOLE_POLICY=<level>` in the runner's environment caps what the hub can allow (the stricter wins), so a machine owner can make it read-only whatever the hub says.
- **Integrations:** the machine page lists Herdr's agent integrations (`integration.list` through any running session; they belong to the machine's user) with install, update and remove, each confirmed and audited. Agents not on the machine are folded away.
- Roles (who may change what) are still later: every signed-in user has the machine's console access; only admins change it.

## Attention as built (M5, 2026-09-27)

- **The hub notices:** comparing each session's consecutive views, an agent that becomes blocked raises `needs_you` and one that goes from working to done or idle raises `finished` (a session's first report after a reconnect raises nothing; the same agent and kind at most once a minute). Events are stored (`attention_event`, two weeks) and pushed live on the `agents` topic.
- **Every browser hears it:** a toast (Open, and Reply for needs-you), unless you're looking at that pane in the workspace (the workspace answers a "watching" probe); a desktop notification when the tab is in the background, if turned on in the inbox (per browser). The workspace's own per-session toasts were replaced by this.
- **Inbox** (sidebar, badge: agents needing you in red, else unread events): agents asking something now, each with the bottom of its screen (read live every 3 s while open) and quick replies: numbered choices found on the screen (sent as that key), Enter, Esc, and a reply box (text + Enter); then the recent events. Replies type into the pane, so they need the machine's Agents access.
- Herdr has no "what is it asking" field; the screen is the source.

