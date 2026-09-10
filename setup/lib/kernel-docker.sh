#!/usr/bin/env bash
# Only opted-in cloud preparation installs/starts Docker. Local check mode never does.
kernel_docker_image() {
  (cd "$AGENT_REPO_ROOT" && node --input-type=module -e "import { DEFAULT_IMAGE } from './backend/falkordb/evidence/lib/falkordb.mjs'; console.log(DEFAULT_IMAGE)")
}
kernel_prepare_docker() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    agent_system_install docker.io docker-compose-v2
  fi
  kernel_start_docker
  local image
  image="$(kernel_docker_image)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    [[ "$AGENT_SETUP_TOOLS" != check ]] || agent_die "Pull the pinned FalkorDB image first: $image"
    docker pull "$image"
  fi
  docker compose version
  agent_log 'Docker engine and pinned functional FalkorDB image are ready; no database started'
}

# Resume only the installed service: no package installation or image download.
kernel_start_docker() {
  if ! docker info >/dev/null 2>&1; then
    [[ "$AGENT_SETUP_TOOLS" != check ]] || agent_die 'Start Docker on your machine, then rerun setup'
    [[ "$(id -u)" == 0 ]] || agent_die 'Docker daemon unavailable; start it with your system service manager'
    kernel_clear_stale_pid /var/run/docker.pid
    mkdir -p "$AGENT_SETUP_HOME/logs"
    nohup dockerd > "$AGENT_SETUP_HOME/logs/kernel-docker.log" 2>&1 < /dev/null &
    for ((attempt=0; attempt<30; attempt++)); do
      if docker info >/dev/null 2>&1; then break; fi
      sleep 1
    done
    docker info >/dev/null 2>&1 || agent_die "Docker daemon could not start; inspect $AGENT_SETUP_HOME/logs/kernel-docker.log"
  fi
}
kernel_resume_docker() {
  command -v docker >/dev/null || agent_die "Prepared Docker executable is missing"
  docker compose version >/dev/null
  kernel_start_docker
  docker image inspect "$(kernel_docker_image)" >/dev/null || agent_die "Prepared FalkorDB image is missing; rerun explicit setup"
}

# A reboot can recycle the saved PID for an unrelated process. Never kill it.
kernel_clear_stale_pid() {
  local file="$1" pid command
  [[ -f "$file" ]] || return 0
  pid="$(cat "$file")"
  command=""
  if [[ "$pid" =~ ^[0-9]+$ ]]; then command="$(ps -p "$pid" -o comm= 2>/dev/null || true)"; fi
  case "$command" in dockerd|*/dockerd) return 0 ;; esac
  rm -f "$file"
}
