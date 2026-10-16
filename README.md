# mihomo-docker

这是 ClashForShell：基于 Mihomo 和 Zashboard 的 Linux 版网页 Clash Verge。面板源码在 `dashboard/`，订阅管理使用同一容器内的 Sub-Store。

在一台装有 Docker、Docker Compose、Git、curl 和 Python 3 的 Linux 主机上，一条命令安装：

```bash
curl -fsSL https://raw.githubusercontent.com/Orign-al/ClashForShell/main/install.sh | bash
```

也可以在安装时直接传入订阅地址：

```bash
curl -fsSL https://raw.githubusercontent.com/Orign-al/ClashForShell/main/install.sh \\
  | SUBSCRIPTION_URL='https://example.com/your-subscription' bash
```

安装脚本会自动克隆仓库、生成本地配置、构建运行镜像、启动服务，并在 Sub-Store 中创建 `origin-al` 订阅和 `all` 集合。没有订阅地址时可以直接回车，之后在网页中新增。

此目录运行一个独立的 Mihomo Docker 实例，代理和管理页面监听所有网卡：

- HTTP/SOCKS 混合代理：`<主机IP>:27890`
- Mihomo 面板：`http://<主机IP>:29090/ui`
- Sub-Store 订阅管理：`http://<主机IP>:23002`

容器使用 host 网络。控制器仍需要令牌，令牌保存在 `config/config.yaml` 的 `secret` 字段。

手动部署：

```bash
cp .env.example .env
# 编辑 .env，填入你的订阅地址
python3 scripts/update-subscription.py
docker compose up -d
```

打开 Sub-Store，在“订阅”页面可以新增、编辑、刷新订阅；当前订阅会预置为 `origin-al 订阅`，并加入 `all` 集合。Mihomo 会自动从 `all` 集合读取节点。

更新订阅：

```bash
python3 scripts/update-subscription.py
docker compose restart mihomo
```

检查状态：

```bash
docker compose ps
docker compose logs --tail=100 mihomo
curl http://127.0.0.1:29090/version
```

`.env` 和 `config/config.yaml` 已被 `.gitignore` 忽略，请勿提交订阅地址或控制器令牌。

面板二次开发：

```bash
cd dashboard
corepack enable
pnpm install --frozen-lockfile
pnpm run type-check
pnpm run build
cd ..
docker compose build --pull=false
docker compose up -d
```
