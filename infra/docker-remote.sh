#!/usr/bin/env bash
# Deterministic entrypoint for all Docker operations against the remote
# Docker host at 192.168.1.17 (SSH alias: mola-docker, a restricted `claude`
# account whose key can only run /home/claude/docker-gate.sh). This is the
# ONLY sanctioned way for agents/scripts to talk to that host's Docker
# daemon — no raw `ssh ... docker ...`, no local `docker` calls.
set -euo pipefail

HOST="mola-docker"
REMOTE_DIR="mola-infra"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") <action> [args...]

Actions:
  up [service...]                 Start services (detached)
  down                             Stop and remove services
  restart [service...]             Restart services
  build [service...]               Build service images
  ps                                Show service status
  logs [service...] [-f] [--tail N] Show service logs
  exec <service> <cmd...>          Run a command inside a running container

Runs against the Docker daemon on 192.168.1.17 (SSH host: $HOST). Syncs
infra/ to the remote host before every command, so the compose file and
init scripts are always current.
EOF
}

action="${1:-}"
if [[ -z "$action" || "$action" == "-h" || "$action" == "--help" ]]; then
  usage
  exit "$([[ -z "$action" ]] && echo 1 || echo 0)"
fi
shift

case "$action" in
  up)
    set -- -d "$@"
    ;;
  down|restart|build|ps|logs) ;;
  exec)
    if [[ $# -lt 2 ]]; then
      echo "Usage: $(basename "$0") exec <service> <command...>" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown action: $action" >&2
    usage
    exit 1
    ;;
esac

rsync -az --delete --exclude 'terraform/' "$SCRIPT_DIR"/ "$HOST:$REMOTE_DIR"/

# The ingest-worker service's Dockerfile build context — synced as a
# subdirectory of REMOTE_DIR (not a sibling) so it travels with the same
# rsync target docker-gate.sh already trusts; docker-compose.yml's build
# context is `./ingest` to match.
rsync -az --delete \
  --exclude '.venv/' --exclude '.pytest_cache/' --exclude '__pycache__/' --exclude '.env' \
  "$SCRIPT_DIR/../apps/ingest"/ "$HOST:$REMOTE_DIR/ingest"/

remote_cmd=("$action" "$@")
printf -v quoted_cmd '%q ' "${remote_cmd[@]}"
ssh "$HOST" "$quoted_cmd"
