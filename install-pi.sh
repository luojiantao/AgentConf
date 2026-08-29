#!/usr/bin/env bash
# Install pi CLI and apply this repo's public pi/agent snapshot to ~/.pi/agent.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./install-pi.sh [--skip-cli] [--dry-run] [--dest DIR]

Install @earendil-works/pi-coding-agent and sync shareable config from
./pi/agent to ~/.pi/agent (or $PI_CODING_AGENT_DIR).

Never overwrites: auth.json, models.json, trust.json, sessions/
Never copies:     *.exe, npm/node_modules
EOF
}

SKIP_CLI=0
DRY_RUN=0
DEST="${PI_CODING_AGENT_DIR:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-cli) SKIP_CLI=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --dest)
      DEST="${2:-}"
      if [[ -z "$DEST" ]]; then
        echo "error: --dest requires a path" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/pi/agent"
if [[ -z "$DEST" ]]; then
  DEST="${HOME}/.pi/agent"
fi

if [[ ! -d "$SRC" ]]; then
  echo "error: missing snapshot directory: $SRC" >&2
  exit 1
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

echo "source: $SRC"
echo "dest:   $DEST"

need_cmd npm
need_cmd node

if [[ "$SKIP_CLI" -eq 0 ]]; then
  echo "installing pi CLI..."
  run npm install -g --ignore-scripts @earendil-works/pi-coding-agent
fi

if ! command -v pi >/dev/null 2>&1 && [[ "$DRY_RUN" -eq 0 ]]; then
  echo "error: pi is not on PATH after install" >&2
  exit 1
fi

run mkdir -p "$DEST"

copy_file() {
  local rel="$1"
  if [[ -f "$SRC/$rel" ]]; then
    run mkdir -p "$(dirname "$DEST/$rel")"
    run cp "$SRC/$rel" "$DEST/$rel"
  fi
}

mirror_dir() {
  local rel="$1"
  if [[ ! -d "$SRC/$rel" ]]; then
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] mirror $rel/"
    return 0
  fi
  rm -rf "$DEST/$rel"
  mkdir -p "$(dirname "$DEST/$rel")"
  cp -R "$SRC/$rel" "$DEST/$rel"
}

copy_file AGENTS.md
copy_file APPEND_SYSTEM.md
copy_file settings.json
copy_file preloop-gate.json
copy_file auth.json.example
copy_file models-store.json

for dir in Actor Domain Stack agents extensions skills prompts; do
  mirror_dir "$dir"
done

if [[ -d "$SRC/bin" ]]; then
  run mkdir -p "$DEST/bin"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] copy bin/* except *.exe"
  else
    find "$SRC/bin" -maxdepth 1 -type f ! -name '*.exe' -exec cp {} "$DEST/bin/" \;
  fi
fi

if [[ -f "$SRC/npm/.gitignore" ]]; then
  run mkdir -p "$DEST/npm"
  run cp "$SRC/npm/.gitignore" "$DEST/npm/.gitignore"
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  export PI_CODING_AGENT_DIR="$DEST"
  PACKAGES="$(node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const p of s.packages || []) {
      console.log(typeof p === "string" ? p : p.source);
    }
  ' "$DEST/settings.json")"
  if [[ -n "$PACKAGES" ]]; then
    echo "installing pi packages from settings.json..."
    while IFS= read -r pkg; do
      [[ -z "$pkg" ]] && continue
      echo "  pi install $pkg"
      pi install "$pkg"
    done <<< "$PACKAGES"
  fi
else
  echo "[dry-run] PI_CODING_AGENT_DIR=$DEST pi install <packages from settings.json>"
fi

echo
echo "done."
echo "preserved on dest if present: auth.json, models.json, trust.json, sessions/"
if [[ ! -f "$DEST/auth.json" ]]; then
  echo "next: copy $DEST/auth.json.example to auth.json and fill keys, or run: pi  then /login"
fi
if [[ ! -f "$DEST/models.json" ]]; then
  echo "next: add ~/.pi/agent/models.json if you use custom providers (not shipped in this public repo)"
fi
