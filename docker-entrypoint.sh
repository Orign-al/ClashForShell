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

exec /entrypoint.sh "$@"
