---
name: docker-remote
description: Use for ANY Docker operation in this project — starting/stopping/restarting services, checking status, viewing logs, or exec'ing into a container. Docker itself does not run on this machine; it runs on a remote host at 192.168.1.17. This is the only sanctioned way to reach it.
---

# Docker on 192.168.1.17

Postgres and LocalStack (defined in `infra/docker-compose.yml`) run on a
remote Docker host at 192.168.1.17, not locally. All access goes through
`infra/docker-remote.sh` — a fixed whitelist of actions over a restricted
SSH account (`claude@192.168.1.17`, alias `mola-docker`) whose key can only
run one forced command on that host. Never SSH there directly, never run
`docker` locally (it isn't even installed on this machine), and never touch
the `pctoo` SSH alias (that's the personal account) for Docker operations.

## Usage

```bash
infra/docker-remote.sh <action> [args...]
```

Or via pnpm for the two most common ones:

```bash
pnpm docker:up      # start Postgres + LocalStack, detached
pnpm docker:down    # stop and remove them
```

Actions:

| Action | Example |
|---|---|
| `up [service...]` | `infra/docker-remote.sh up` |
| `down` | `infra/docker-remote.sh down` |
| `restart [service...]` | `infra/docker-remote.sh restart postgres` |
| `build [service...]` | `infra/docker-remote.sh build` |
| `ps` | `infra/docker-remote.sh ps` |
| `logs [service...] [-f] [--tail N]` | `infra/docker-remote.sh logs --tail 50 postgres` |
| `exec <service> <cmd...>` | `infra/docker-remote.sh exec postgres psql -U mola -d mola -c "select 1;"` |

That is the complete set. The script syncs `infra/` to the remote host
before every call, so the compose file and init scripts there are always
current with what's in the repo.

## Why this exists

A leaked or misused credential here is scoped to exactly these actions
against this one compose project — nothing else on that host. Don't work
around the script (e.g. raw `ssh mola-docker ...` or a new SSH key) even
if it would be faster for a one-off task; if you need an action that isn't
in the whitelist, say so instead of improvising a new path.
