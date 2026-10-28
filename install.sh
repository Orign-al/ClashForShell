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
  SUBSCRIPTION_URL=""
  if [ -t 0 ]; then
    printf '请输入 Mihomo 订阅地址（可留空，稍后在网页中添加）： '
    IFS= read -r SUBSCRIPTION_URL || SUBSCRIPTION_URL=""
  elif { exec 3</dev/tty; } 2>/dev/null; then
    if [ -t 3 ]; then
      # With `curl URL | bash`, stdin is the script itself. Read the answer
      # from the controlling terminal so the next shell line is not consumed.
      printf '请输入 Mihomo 订阅地址（可留空，稍后在网页中添加）： '
      IFS= read -r SUBSCRIPTION_URL <&3 || SUBSCRIPTION_URL=""
    fi
    exec 3<&-
  fi
fi
umask 077
printf 'SUBSCRIPTION_URL=%s\n' "$SUBSCRIPTION_URL" > .env

mkdir -p config
rm -rf config/ui
if [ -n "$SUBSCRIPTION_URL" ]; then
  python3 scripts/update-subscription.py
else
  python3 scripts/update-subscription.py --empty
fi
docker compose build
docker compose up -d --remove-orphans

sub_store_ready=0
for attempt in $(seq 1 60); do
  # The host may use an HTTP proxy for GitHub/subscription downloads. The
  # health probe must always go directly to this machine's Sub-Store.
  if curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:23001/api/collections >/dev/null 2>&1; then
    sub_store_ready=1
    break
  fi
  if [ $((attempt % 10)) -eq 0 ]; then
    echo "等待 Sub-Store 启动（${attempt}/60 秒）..." >&2
  fi
  sleep 1
done
if [ "$sub_store_ready" -ne 1 ]; then
  echo 'Sub-Store 启动超时，请运行 docker compose ps 和 docker compose logs mihomo 检查。' >&2
  exit 1
fi
python3 scripts/bootstrap-substore.py
docker compose restart mihomo >/dev/null

controller_token="$(sed -n 's/^secret: "\([^\"]*\)"$/\1/p' config/config.yaml)"
mihomo_ready=0
for attempt in $(seq 1 60); do
  if curl --noproxy '*' -fsS --max-time 2 \
    --header "Authorization: Bearer $controller_token" \
    http://127.0.0.1:29090/version >/dev/null 2>&1; then
    mihomo_ready=1
    break
  fi
  if [ $((attempt % 10)) -eq 0 ]; then
    echo "等待 Mihomo 控制器启动（${attempt}/60 秒）..." >&2
  fi
  sleep 1
done
if [ "$mihomo_ready" -ne 1 ]; then
  echo 'Mihomo 控制器启动超时，请运行 docker compose ps 和 docker compose logs mihomo 检查。' >&2
  exit 1
fi

echo
echo 'ClashForShell 已安装并启动。'
echo "安装目录：$PWD"
echo '代理端口：0.0.0.0:27890'
echo 'Zashboard： http://<主机IP>:29090/ui'
echo '订阅管理： http://<主机IP>:23002'
echo 'Zashboard 首次连接时，“密码”填写 Mihomo 控制器令牌，不是 Linux 登录密码。'
echo '读取令牌：sed -n '\''s/^secret: "\\(.*\\)"$/\\1/p'\'' config/config.yaml'
