#!/usr/bin/env bash
# Install or update the token-stats V2 TUI plugin.
#   ./install.sh              install/update
#   ./install.sh --remove     remove the plugin and its cli.json entry
set -euo pipefail

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_SRC="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DST="$CONFIG_DIR/plugins/opencode-token-stats"
CLI="$CONFIG_DIR/cli.json"

if [ "${1:-}" = "--remove" ]; then
  rm -rf "$PLUGIN_DST"
  python3 - "$CLI" <<'PY'
import json, shutil, sys
p = sys.argv[1]
with open(p) as f: cfg = json.load(f)
plugins = cfg.get("plugins") or []
def drop(entry):
    pkg = entry.get("package", "") if isinstance(entry, dict) else str(entry)
    return "opencode-token-stats" in str(pkg)
cfg["plugins"] = [e for e in plugins if not drop(e)]
if not cfg["plugins"]: cfg.pop("plugins", None)
shutil.copy2(p, p + ".bak")
with open(p, "w") as f: json.dump(cfg, f, indent=2); f.write("\n")
print(f"removed plugin entry from {p} (backup at {p}.bak)")
PY
  echo "removed $PLUGIN_DST"
  exit 0
fi

rm -rf "$PLUGIN_DST"
cp -r "$PLUGIN_SRC" "$PLUGIN_DST"
echo "wrote $PLUGIN_DST"

python3 - "$CLI" <<'PY'
import json, shutil, sys
p = sys.argv[1]
cfg = {}
if __import__("os").path.exists(p):
    with open(p) as f:
        try:
            cfg = json.load(f)
        except json.JSONDecodeError:
            cfg = {}
    shutil.copy2(p, p + ".bak")
entry = {"package": "./plugins/opencode-token-stats", "options": {}}
plugins = [e for e in (cfg.get("plugins") or [])
           if "opencode-token-stats" not in str(e.get("package", ""))]
cfg["plugins"] = plugins + [entry]
with open(p, "w") as f: json.dump(cfg, f, indent=2); f.write("\n")
print(f"registered in {p}")
PY

echo
echo "Restart opencode (plugins load only at startup)."
echo "Then run a prompt and look for the Tokens block under Context."
