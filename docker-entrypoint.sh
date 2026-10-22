#!/bin/sh
set -eu

# The base image restores its dashboard only when the persistent UI directory
# is empty.  Copy the bundled dashboard on every start so an upgraded image
# cannot keep serving stale assets from the config volume.
ui_dir=/root/.config/mihomo/ui
builtin_ui_dir=/opt/mihomo/ui

if [ -d "$builtin_ui_dir" ]; then
  mkdir -p "$ui_dir"
  cp -a "$builtin_ui_dir"/. "$ui_dir"/
fi

node /opt/clashforshell/configure-substore.mjs
node /opt/clashforshell/sync-substore.mjs &
sync_pid=$!

/entrypoint.sh "$@" &
service_pid=$!

cleanup() {
  trap '' TERM INT
  kill -TERM "$sync_pid" "$service_pid" 2>/dev/null || true
  wait "$service_pid" 2>/dev/null || true
  wait "$sync_pid" 2>/dev/null || true
}
trap 'cleanup; exit 0' TERM INT

status=0
wait "$service_pid" || status=$?
cleanup
exit "$status"
