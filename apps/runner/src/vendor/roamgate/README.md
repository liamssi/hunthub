# Roamgate endpoint client (vendored)

Herdr's native endpoint protocol ("generation 1": bincode frames on
`herdr-client.sock`), used by the runner's `native` terminal transport.

- Source: Roamgate `server/src/bridge/` and `server/src/utils/logger.ts`,
  commit `5eaf141fc782e84941cf0d3c24f08e1348238617` (2026-09-25).
- License: MIT, see `LICENSE` in this folder (Copyright (c) 2026 Arthur).

Copied unchanged except:

- `thin-client.ts`: only the `FrameData` types and readers are kept.
- `logger.ts`: only the `Logger` type and `silentLogger`.
- `endpoint-terminal-session.ts`: imports the logger from `./logger`; adds
  `paneState()` (mouse reporting, alternate screen, size) for HuntHub.
- `endpoint-surface.ts`, `endpoint-client.ts`: keep the pane's
  `alternate_screen_active` flag (`alternateScreen`) instead of skipping it.

HuntHub code lives outside this folder (`src/herdr/terminals.ts`); keep edits
here minimal so upstream fixes can be pulled in by copying the files again.
