# Herdr as the HuntHub agent runtime: research notes (2026-09-25)

Sources: herdr.dev docs (0.9.1), github.com/herdrdev/herdr source at tag v0.9.1. The local machine was upgraded from 0.7.5 to 0.9.1 on 2026-09-25 (integrations: claude v10, codex v8, pi v9, hermes v5).
Herdr is Apache-2.0 and written in Rust. It is essentially a single-maintainer project with a release every 1–3 weeks, and minor versions include breaking behaviour changes.

## Versions
- Latest stable is **0.9.1** (JSON API protocol 22). 0.7.5 used protocol 17.
- 0.9.x adds: SSH multi-machine (`herdr machine`, `--machine`), headless resume, `agent_blocked`, and endpoint generations.
- The JSON API is lenient: ignore unknown fields. An unknown method returns `invalid_request` with an empty `id`.
- The binary client protocol (used by terminal observe/control and handoff) requires the **same build** on both ends. Always spawn the `herdr` binary from the same install as the server.

## Object model
- **Server:** one per session. It has two sockets:
  - `~/.config/herdr[/sessions/<name>]/herdr.sock`: NDJSON API, mode 0600
  - `herdr-client.sock`: binary protocol
- Hierarchy: workspace (`w1`) → tab (`w1:t1`) → pane (`w1:p1`, a real PTY) → agent (the foreground process Herdr recognises).
- IDs are per-server counters. They survive restarts via `session.json`, but they are not unique across machines, and `pane.move` changes the pane id.
- Metadata tokens (`workspace/pane.report_metadata`) are display-only and are **not restored** after a restart. Keep HuntHub's own IDs, and pass `HUNTHUB_RUN_ID` in the pane env.

## Agent states
- `working`, `blocked`, `idle`, `done` (= idle and not yet seen; `agent.focus` marks it seen), `unknown`.
- **Claude Code and Codex are classified from the screen** using TOML manifests. Their integration hooks report only the session id.
  - Blocked detection is strict: an unrecognised approval prompt shows as `idle`.
  - Treat state as a hint. **Don't take over state with hooks.** Herdr used hook-reported Claude state before v0.8 and dropped it: stale `working` after a cancel, subagent and recap events reviving idle panes, stale `blocked` (CHANGELOG, "report session identity only").
  - HuntHub's own Claude hooks (PermissionRequest, Stop, Notification, and later PreToolUse scope checks) should send **extra context** to the runner, such as which tool or command wants approval, without calling `pane.report_agent`.
  - Install them beside Herdr's hook, never inside its managed script.
  - For approval prompts Herdr doesn't recognise, add a timeout plus the live terminal as a fallback.
- Hook-authoritative agents: Pi, OMP, Kimi, OpenCode, Kilo, MastraCode. Custom agents can report state themselves via `pane.report_agent{source:"custom:x", state, message, seq}`.
- Screen manifests:
  - Remote updates come from herdr.dev with no signature check. Disable with `[update] manifest_check=false`.
  - Pin by placing overrides in `~/.config/herdr/agent-detection/<agent>.toml`.
  - Debug with `agent.explain`.
- `HERDR_AGENT=claude <wrapper> -- claude` applies the Claude manifest to a wrapper process. This may allow `docker run -it` agents (untested).

## Starting agents
1. `workspace.create{cwd, env, label, focus:false}`, `tab.create`, or `pane.split`. **cwd and env go here.** Herdr's own `HERDR_*` variables win over anything passed.
2. `agent.start{name, kind, pane_id, args, timeout_ms 3001–300000}`.
   - It **types the command into the pane's shell**, so args end up in shell history and scrollback. Never put secrets in args.
   - Kinds: pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, maki, (0.9) qwen, letta, muse.
   - Errors to handle: `agent_not_ready` (e.g. a trust dialog), `agent_blocked`.
3. `agent.prompt{target, text, wait?}` uses bracketed paste plus Enter.
   - Refused if the agent is blocked.
   - Returns `agent_prompt_stalled` if nothing starts within 5 s.
   - A timeout does not mean the prompt wasn't delivered.
- `layout.apply` builds a pane tree where each pane has `command` (argv), `cwd` and `env`. Use it to run arbitrary processes.
- Input methods:
  - `pane.send_input{text, keys}`: atomic.
  - `pane.send_keys`: key names such as `enter`, `esc`, `ctrl+c`, `shift+tab`.
  - `pane.send_text`: raw bytes.

## Reading and waiting
- `pane.read` / `agent.read` sources:
  - `visible`
  - `recent` (80 rows by default)
  - `recent_unwrapped`: best for transcripts
  - `detection`
  - `format: text|ansi`. The result has a `revision`; use it to skip unchanged reads.
  - Full-screen agents scroll their own history, and only while idle.
- `agent.wait{target, until[], timeout_ms}` and `pane.wait_for_output{match}`.
- `events.wait` only supports `pane_agent_status_changed`.

## Socket API mechanics
- **One request per connection.** The client sends one line, the server answers once and closes the connection.
- Concurrency comes from opening many connections. Each request has a 5 s app timeout.
- Long-lived calls hold their connection open: `events.subscribe` (streams `{event, data}` lines with no id), waits, and `agent.prompt` with `wait`.
- To unsubscribe, close the socket.
- Events come from a **512-event ring** that is polled every 100 ms, with no replay and no sequence number. A slow subscriber silently loses events, so reconcile with `agent.list` every 5–10 s.
- Bootstrap sequence:
  1. Subscribe first and wait for `subscription_started`.
  2. Call `session.snapshot`.
  3. Apply the buffered events.
  4. After every reconnect, do the whole thing again.
- Agent status changes only arrive through a per-pane `pane.agent_status_changed{pane_id}` subscription (verified: no general event fires). The runner keeps one subscription covering exactly the panes that host an agent (from `snapshot.agents`), rebuilt when that set changes (Roamgate does the same).
- Event catalog:
  - `workspace.*`, `worktree.created/opened/removed`, `tab.*`
  - `pane.created/updated/closed/focused/exited/moved/agent_detected/agent_status_changed/output_matched/scroll_changed`
  - `layout.updated`
- Schema: `herdr api schema --json`. Validate against it at runner start.

## Terminal streaming (for web xterm.js)
- View only: `herdr terminal session observe <pane|agent> --cols --rows`.
  - Prints NDJSON: `{"type":"terminal.frame","seq","encoding":"ansi","width","height","full","bytes":b64}`, ending with `terminal.closed`.
  - Frames are server-rendered ANSI diffs; `full: true` means a complete redraw.
  - Any number of observers can watch. A stalled observer is dropped after 30 s.
- Writable: `herdr terminal session control <target> [--takeover]`.
  - stdin accepts `terminal.input{text|bytes}`, `terminal.resize`, `terminal.scroll`, `terminal.release`.
  - Only one controller at a time, and it likely resizes the real PTY. HuntHub must decide who is driving.
- These run over the binary protocol. **Spawn the CLI as a subprocess**; don't implement the protocol.

## Persistence
- **Detach:** everything keeps running.
- **Server restart or reboot:** processes die. Layout and cwd are restored, and panes come back as fresh shells.
- **Native resume** (`[session] resume_agents_on_restore`, on by default) relaunches `claude --resume <id>` / `codex resume <id>` when the official integration reported the session id. From 0.8 this also works headless.
- `[experimental] pane_history` saves screen contents to disk. Off by default; it can capture secrets.
- Scrollback is 10 MB per pane (`advanced.scrollback_limit_bytes`).
- `herdr update --handoff` is experimental. Don't rely on it; plan for restart + resume.

## Headless operation
- `herdr server` runs in the foreground and suits systemd. Use a dedicated user and a named session (`HERDR_SESSION=hunthub`).
- Headless panes are 120x40 (`[server] headless_cols/rows`).
- Raise systemd `TasksMax` (issue #3324).
- Disable `update.version_check` and upgrade deliberately. Pin a Herdr version per runner release.

## Security
- There is **no auth beyond socket file permissions (0600)**. Socket access means full control of every pane.
- Plugins are unsandboxed and the marketplace is unreviewed. Allow-list plugins pinned to commits.
- Outbound calls: version check and manifest updates.

## Worktrees and notifications
- `worktree.list/create/open/remove`. Worktrees go under `~/.herdr/worktrees/<repo>/<branch>`. Remove never deletes the branch.
- `notification.show` only reaches a connected TUI. There are no external channels, so HuntHub builds its own from status events.

## Multi-machine (Herdr's own)
- `herdr machine add <ssh-target>` and `herdr --machine <label> <cmd>`.
  - Each `--machine` call opens SSH and runs `herdr remote-api-bridge`.
  - It can't subscribe or stream, and the machine must be reachable over SSH.
- **Herdr Cloud** ("coming soon"): a relay to your machines without SSH, end-to-end encrypted. Overlaps with HuntHub's connectivity layer only.
- HuntHub does not depend on either: one runner per machine connects outbound.

## Plugins
- Manifest `herdr-plugin.toml`:
  - `[[build]]` and `[[startup]]` (one-shot, not supervised)
  - `[[actions]]` (can be bound to keys)
  - `[[events]]` (async, fire-and-forget, receive `HERDR_PLUGIN_EVENT_JSON`)
  - `[[panes]]` (overlay, popup, split, tab)
  - `[[link_handlers]]`
- Plugins can't host a daemon, veto an action, or add non-terminal UI.
- A companion `hunthub.herdr` plugin could add:
  - actions: link a pane to a hunt, report a finding, request approval
  - a popup listing pending interventions
  - a link handler for HuntHub URLs
  - sidebar tokens
- Marketplace examples worth studying:
  - pairfob (machine dials out)
  - herdr-mobile-relay, collie (remote approvals, push)
  - herdr-telegram-agents
  - herdr-board, herdr-dagr (orchestration UIs)
  - termaxa (command policy and audit)
  - agentbox (VM sandboxes)

## Hermes
- `herdr integration install hermes` puts a Hermes plugin in `~/.hermes/plugins/` that reports the session id.
- Hermes orchestrates through the Herdr skill (`agent start/prompt/wait/read`). It is a peer socket client, just like the HuntHub runner.
