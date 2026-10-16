#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/Orign-al/ClashForShell.git}"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/clashforshell}"

for command_name in docker curl python3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "未找到 $command_name，请先安装后重试。" >&2
    exit 1
  fi
done
if ! command -v git >/dev/null 2>&1; then
  echo '未找到 git，请先安装后重试。' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo '未找到 docker compose，请先安装 Docker Compose Plugin。' >&2
  exit 1
fi

if [ ! -f docker-compose.yml ] || [ ! -f scripts/update-subscription.py ]; then
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [ -e "$INSTALL_DIR" ] && [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)" ]; then
    echo "安装目录非空：$INSTALL_DIR" >&2
    exit 1
  fi
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

if [ -z "${SUBSCRIPTION_URL:-}" ]; then
  printf '请输入 Mihomo 订阅地址（可留空，稍后在网页中添加）： '
  read -r SUBSCRIPTION_URL
fi
umask 077
printf 'SUBSCRIPTION_URL=%s\n' "$SUBSCRIPTION_URL" > .env

mkdir -p config
rm -rf config/ui
python3 scripts/update-subscription.py
docker compose build
docker compose up -d --remove-orphans

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:23001/api/collections >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
python3 scripts/bootstrap-substore.py
docker compose restart mihomo >/dev/null

echo
echo 'ClashForShell 已安装并启动。'
echo "安装目录：$PWD"
echo '代理端口：0.0.0.0:27890'
echo 'Zashboard： http://<主机IP>:29090/ui'
echo '订阅管理： http://<主机IP>:23002'
echo '控制器令牌：grep "^secret:" config/config.yaml'
