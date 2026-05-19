#!/usr/bin/env bash
set -euo pipefail

dry_run=0

for arg in "$@"; do
  case "$arg" in
    --dry-run | -n)
      dry_run=1
      ;;
    --help | -h)
      cat <<'EOF'
Usage: scripts/archive-workspace.sh [--dry-run]

Stops local dev processes for this workspace and runs:
  docker compose down --remove-orphans

Options:
  -n, --dry-run  Print the processes and Compose command without stopping them.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

workspace="${CONDUCTOR_WORKSPACE_PATH:-$(pwd -P)}"
workspace="$(cd "$workspace" && pwd -P)"

cd "$workspace"

if [[ ! -f .env ]] && command -v bun >/dev/null 2>&1; then
  bun run ports:write >/dev/null 2>&1 || true
fi

dotenv_value() {
  local key="$1"

  [[ -f .env ]] || return 0

  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      if (value ~ /^".*"$/) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' .env
}

belongs_to_workspace() {
  local pid="$1"
  local cwd=""
  local command=""

  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  if [[ "$cwd" == "$workspace" || "$cwd" == "$workspace"/* ]]; then
    return 0
  fi

  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$workspace"* ]]
}

terminate_pids() {
  local signal="$1"
  shift

  for pid in "$@"; do
    if [[ -n "$pid" ]] && belongs_to_workspace "$pid"; then
      if [[ "$dry_run" == "1" ]]; then
        printf '[dry-run] Would send %s to PID %s\n' "$signal" "$pid"
      else
        kill "-$signal" "$pid" 2>/dev/null || true
      fi
    fi
  done
}

describe_pids() {
  for pid in "$@"; do
    [[ -n "$pid" ]] || continue

    if belongs_to_workspace "$pid"; then
      printf '  PID %s: %s\n' \
        "$pid" \
        "$(ps -p "$pid" -o command= 2>/dev/null || true)"
    fi
  done
}

workspace_pids_matching() {
  local pattern="$1"
  local pid=""

  while IFS= read -r pid; do
    if [[ -n "$pid" ]] && belongs_to_workspace "$pid"; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

listener_pids_for_port() {
  local port="$1"

  [[ "$port" =~ ^[0-9]+$ ]] || return 0
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

app_port="${PORT:-$(dotenv_value PORT)}"
process_pattern='(scripts/dev\.ts|vite|playwright)'

pids="$(
  {
    listener_pids_for_port "$app_port"
    workspace_pids_matching "$process_pattern"
  } | sort -u
)"

if [[ "$dry_run" == "1" ]]; then
  printf '[dry-run] Workspace: %s\n' "$workspace"
  printf '[dry-run] App port: %s\n' "${app_port:-none}"
  if [[ -n "$pids" ]]; then
    printf '[dry-run] Matching workspace processes:\n'
    describe_pids $pids
  else
    printf '[dry-run] Matching workspace processes: none\n'
  fi
  printf '[dry-run] Would run: docker compose down --remove-orphans\n'
  exit 0
fi

terminate_pids TERM $pids
sleep 2

remaining_pids="$(
  {
    listener_pids_for_port "$app_port"
    workspace_pids_matching "$process_pattern"
  } | sort -u
)"

terminate_pids KILL $remaining_pids

docker compose down --remove-orphans
