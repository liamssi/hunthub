# Paperclip: reference notes (2026-09-27)

https://github.com/paperclipai/paperclip. MIT licence. "Open-source orchestration for teams of AI agents": a self-hosted control plane that models a company (org chart, goals, budgets, governance) whose employees are AI agents. Studied at commit `0f14d26` (2026-09-27); paths below are in that repo.

**How we use it:** a source of ideas, especially for integrating many agent harnesses behind one contract. Not a dependency; very large and changing daily (~88k stars, ~200 contributors, daily canary releases, created 2026-03).

## Shape
- **Stack:**
  - Node 24 + TypeScript server (`server/`)
  - React UI (`ui/`)
  - Postgres via Drizzle (about 150 tables, `packages/db/src/schema`)
  - pnpm monorepo
  - a newer Rust runner daemon (`packages/paperclip-runner/runner/`)
- **Deployment:** one central server, multi-tenant ("companies"), port 3100, with loopback or authenticated modes (`--bind lan|tailnet`). Also Docker and AWS ECS (`doc/DEPLOYMENT-MODES.md`, `docs/deploy/`).
- **Concepts:**
  - Company.
  - Goals: a hierarchy.
  - Projects, with git-worktree workspaces.
  - Agents: role, `reportsTo`, status, monthly budget, `adapterType` + `adapterConfig`.
  - Issues/tasks: parents, blockers, comments, documents, work products (PR, branch, preview), `backlog…in_review…done`.
  - Routines: cron, webhook or API, each firing creating an issue.
  - Approvals, execution policies, budgets, secrets, plugins, watchdogs, and an activity log.

## The harness layer (the "meta harness")
The phrase "meta harness" isn't in the repo (it's presumably website wording). In the code, harnesses are integrated at two layers.

### Adapters (primary): a harness is a headless function
`packages/adapter-utils/src/types.ts`:
```ts
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx): Promise<AdapterEnvironmentTestResult>;   // installed? logged in?
  sessionCodec?: AdapterSessionCodec;          // serialize/deserialize resume params
  sessionManagement?: AdapterSessionManagement; // resume + compaction policy
  listSkills?/syncSkills?; listModels?; getQuotaWindows?; getConfigSchema?;
  getRuntimeCommandSpec?; loginCapability?; acp?: AcpTargetDescriptor; ...
}
```
- **One `execute()` is one run.** The context carries the run id, agent, session (id + params, per task), config, the wake payload, an execution target (local, ssh or sandbox), an AbortSignal, and callbacks for logs, events and spawn.
- **The result:** exit code, timeout, token usage, cost, model, new session params, summary, a question for the human, and an error family (e.g. `provider_quota`) with `retryNotBefore`.
- **Invocation:** CLIs in headless JSON mode, with the prompt on stdin.
  - Claude: `claude --print --output-format stream-json --verbose [--resume <id>] --max-turns … --append-system-prompt-file … --mcp-config …` (`packages/adapters/claude-local/src/server/execute.ts`). Permission bypass is on by default.
  - Codex: `codex exec --json [resume <id> -]` (`packages/adapters/codex-local/src/server/codex-args.ts`).
  - Cursor, Gemini, Grok, OpenCode, Kimi and Pi use their equivalents.
  - Hermes and OpenClaw go through gateways.
  - Generic adapters: `process` (a shell command) and `http` (a webhook; the agent calls back into the API).
- **ACP engine (optional):** `engine: "acp"` drives Claude and Codex through the Agent Client Protocol (`acpx`, `claude-agent-acp`, `codex-acp`). It gives sessionful, structured events (text, tool calls, results, status) (`packages/adapter-utils/src/acpx-engine/`, `docs/adapters/overview.md`).
- **Parsing:** each adapter's `parse.ts` maps stdout into one normalized `TranscriptEntry` union: assistant, thinking, tool_call, tool_result, diff, result with tokens and cost, and so on. The UI and CLI render the same stream.
- **Sessions:**
  - Stored per (agent, task) in `agent_task_sessions`, so each task continues its own conversation.
  - Resume is cwd-aware, with a fresh-session fallback.
  - Compaction/rotation is by runs, tokens or age (`packages/adapter-utils/src/session-compaction.ts`).
  - There's a documented recovery for poisoned Claude sessions (`docs/adapters/claude-local.md`).
- **New harnesses:** a package with `index.ts`, `server/execute.ts`, `parse.ts`, `test.ts`, a UI parser and a CLI formatter (`docs/adapters/creating-an-adapter.md`, `packages/adapters/AUTHORING.md`). External adapters install as npm plugins (`docs/adapters/external-adapters.md`).

### Native runner (newer): a harness is a session with turns
`packages/paperclip-runner/src/contracts/harness-driver.ts`:
```ts
interface HarnessDriver { descriptor(); validateConfig?(); openSession(input); recoverSession?(snapshot, opts); }
interface HarnessSession {
  ids(); events(): AsyncIterable<PrpEvent>;
  startTurn({message, continuation?, requestedCollaborationMode?}): Promise<{turnId}>;
  steer?({turnId, message}); interrupt?({turnId?, reason?});
  pendingRuntimeRequests?(); resolveRuntimeRequest?({requestId, turnId, resolution});
  usage?(); transcript?(); snapshot(); close({reason, force?});
}
```
- **Behaviour:** turns, mid-turn steering, interrupt, durable permission and input requests, and snapshot/recover. There are `per_turn` and `warm` lifecycles.
- **Transport:** a Rust `runnerd` supervises the harness process. It speaks "PRP v1" to the server over a durable WebSocket (an outbox with ACKs).
- **Drivers:**
  - Codex via `codex app-server` (JSON-RPC over stdio, `docs/codex-driver.md`)
  - OpenCode
  - an ACP sidecar for Claude and Codex
  - hosted Claude Managed and AWS AgentCore
- **Permissions:** each harness must declare its permission modes, and the defaults are full-auto. A request that needs approval ends the turn as `approval_required`, and the task is blocked until an operator acts (`docs/adding-a-harness.md`).
- **Agent tools:** Paperclip's own tools (tasks, comments, questions) reach the agent through MCP or a runtime tool bridge.

## Driving agents: heartbeats
- **Wakes, not always-on sessions** (`docs/agents-runtime.md`): on a timer, on assignment, on demand, or by automation, a comment/@mention or an approval. Wakes coalesce while a run is active, and the queue lives in the DB.
- **Each run:**
  1. Checks the budget.
  2. Resolves the workspace.
  3. Injects secrets and skills.
  4. Builds the prompt: template, wake payload, "resume delta" and task context.
  5. Executes, and records the result.
- **The agent talks back to the server itself.** Env vars carry `PAPERCLIP_TASK_ID`, the wake reason and a short-lived run JWT. An injected skill (`skills/paperclip/SKILL.md`, "Heartbeat Procedure") tells the agent to:
  - check out the task (atomic; a 409 means someone else owns it)
  - read its context
  - work
  - leave durable progress as comments, documents and work products
- **Humans:**
  - comments (which can interrupt the active run or reassign it)
  - approval gates
  - structured questions (the task goes `in_review`)
  - pause, resume and terminate
  - session reset
  - chat bridges (Slack, Discord, Telegram, Teams, GitHub)
  - watchdog agents that audit stalled task trees

## Observability
- **Runs:** status `queued/running/succeeded/failed/timed_out/cancelled`; full logs on disk, streamed live; a structured transcript.
- **Costs and budgets:** cost events sliced by company, agent, project, goal, issue, provider and model. Budget warn/hard-stop pauses agents and cancels queued work.
- **Health checks:** silent-run watchdog, stalled-issue recovery, orphaned-run recovery.
- **Other:** activity log, per-user inbox, optional OpenTelemetry and Sentry (`doc/observability.md`).

## Remote execution
- **Push model:** an execution target is `local | ssh | sandbox`. The server stages the workspace, CLI config and credentials onto the target, runs the CLI there and syncs back.
- **Sandbox providers** are plugins (e2b, Daytona, Modal, Cloudflare, Kubernetes…). For the native runner, a per-run `runnerd` is staged and dials back.
- **No resident per-machine daemon** that enrolls with the hub (unlike HuntHub's runner).
- **No live terminal** of a running agent; a PTY exists only for login and setup flows.

## Takeaways for HuntHub
- **Opposite trade-off to ours:**
  - Paperclip runs harnesses headless. It gets exact cost, structured transcripts and deterministic status, but nobody can watch or type into a live session.
  - HuntHub runs them as interactive TUIs in Herdr panes that people can take over. Status comes from the screen or hooks, and cost and transcript are opaque.
- **Worth borrowing:**
  - a per-kind adapter contract: environment test ("installed and logged in?"), models, config schema, session codec
  - a headless engine (stream-json, `exec --json`, ACP) next to the pane engine, for bounded tasks
  - a normalized transcript and run-result record
  - quota-error classification with backoff
  - sessions per (agent, task)
  - atomic task checkout
  - structured questions
  - budgets with hard stops
  - an injected skill plus a run token, so agents report progress themselves
- **Poor fits:**
  - heartbeat-only runs, for long interactive hunts
  - the company/org-chart metaphor
  - full-auto permissions by default, against live targets
  - credential staging over SSH, compared with a resident runner
