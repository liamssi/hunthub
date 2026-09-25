#!/bin/sh
# HuntHub runner installer. Usage (from the hub's "Add machine" dialog):
#   curl -fsSL __HUB_URL__/api/install.sh | sh -s -- <join-token>
# On an already-registered machine, run it without a token to update the runner:
#   curl -fsSL __HUB_URL__/api/install.sh | sh
# Installs the runner for the current user (no root needed), registers this
# machine with the hub and starts it as a systemd user service.
# The runner is a small script run by Bun; Bun is installed from bun.sh if missing.
set -eu

HUB_URL="${HUNTHUB_URL:-__HUB_URL__}"
TOKEN="${1:-}"
APP_DIR="${HUNTHUB_APP_DIR:-$HOME/.local/share/hunthub-runner}"
BIN_DIR="${HUNTHUB_BIN_DIR:-$HOME/.local/bin}"

fail() { echo "error: $*" >&2; exit 1; }

CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/hunthub-runner/config.json"
[ -n "$TOKEN" ] || [ -f "$CONFIG" ] || fail "missing join token. Usage: sh -s -- <join-token>"
[ "$(uname -s)" = "Linux" ] || fail "only Linux is supported for now"
[ "$(id -u)" != "0" ] || echo "warning: installing as root; agents will run as root. Prefer a normal user." >&2
command -v curl >/dev/null || fail "curl is required"
command -v sha256sum >/dev/null || fail "sha256sum is required"
command -v systemctl >/dev/null || fail "systemd is required"

# Bun runs the runner script.
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || [ ! -x "$HOME/.bun/bin/bun" ] || BUN="$HOME/.bun/bin/bun"
if [ -z "$BUN" ]; then
	echo "Installing Bun (https://bun.sh)..."
	command -v unzip >/dev/null || fail "unzip is required to install Bun"
	curl -fsSL https://bun.sh/install | bash >/dev/null
	BUN="$HOME/.bun/bin/bun"
fi
echo "Using Bun $("$BUN" --version) at $BUN"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading the HuntHub runner from $HUB_URL..."
curl -fsSL "$HUB_URL/api/runner/download/hunthub-runner.js" -o "$TMP/hunthub-runner.js"
curl -fsSL "$HUB_URL/api/runner/download/hunthub-runner.js.sha256" | sed 's/hunthub-runner$/hunthub-runner.js/' >"$TMP/sum"
(cd "$TMP" && sha256sum -c --quiet sum) || fail "checksum mismatch; aborting"

# Stop a running service before replacing its files.
systemctl --user stop hunthub-runner.service 2>/dev/null || true
mkdir -p "$APP_DIR" "$BIN_DIR"
install -m 0644 "$TMP/hunthub-runner.js" "$APP_DIR/hunthub-runner.js"
cat >"$BIN_DIR/hunthub-runner" <<WRAPPER
#!/bin/sh
exec "$BUN" "$APP_DIR/hunthub-runner.js" "\$@"
WRAPPER
chmod 0755 "$BIN_DIR/hunthub-runner"
echo "Installed runner $("$BIN_DIR/hunthub-runner" --version) ($BIN_DIR/hunthub-runner)"

if [ -n "$TOKEN" ]; then
	"$BIN_DIR/hunthub-runner" join "$HUB_URL" "$TOKEN"
else
	echo "Already registered; updating the runner only."
fi
"$BIN_DIR/hunthub-runner" install-service
echo "Done. This machine should now show as online in HuntHub."
