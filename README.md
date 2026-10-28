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

安装脚本会自动克隆仓库、生成本地配置、构建运行镜像和启动服务；提供订阅地址时会在 Sub-Store 中创建 `origin-al` 订阅和 `all` 集合。没有订阅地址时可以直接回车，之后在网页中新增。

通过 `curl | bash` 安装时，订阅地址从当前终端读取，不会把安装脚本内容误当成地址；在没有交互终端的环境中会自动以空订阅启动，之后从 `23002` 网页添加订阅。

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

打开 Sub-Store，在“订阅”页面可以新增、编辑、刷新订阅；当前订阅会预置为 `origin-al 订阅`。系统每 2 秒检查一次 `all` 合集，将所有现有订阅自动加入，并同步重命名和删除操作，保留合集的节点处理规则和排序。`all` 是供 Mihomo 读取的全部订阅合集；需要单独组合时可新建其他合集。

保存订阅后，在 Zashboard 的“代理提供者”中刷新 `sub-store` 即可加载新节点。仅在 Sub-Store 中新增订阅、但没有加入 Mihomo 使用的合集，会导致空合集下载返回 500；上述自动同步会修复这种情况。没有任何订阅时，请先在网页中添加有效订阅。

从面板点击“订阅管理”或直接打开 `23002` 页面时，会自动连接当前主机上的 Sub-Store 后端，无需输入 backend path。地址随浏览器访问的主机名或 IP 生成，迁移部署无需修改 IP。手动配置时，后端路径为 `/mihomo-sub-store-api`（同一主机的 `23002` 端口）；显式传入 `?api=...` 或 `?magicpath=...` 可以连接自定义后端。

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

验证订阅合集同步（在项目根目录执行，使用临时数据且不连接外网）：

```bash
docker run --rm --network none --entrypoint node \
  -v "$PWD/scripts:/tests:ro" clashforshell:latest /tests/test-substore.mjs
```

测试覆盖空合集修复、新增 / 重命名 / 删除订阅、处理规则和排序保留、合集删除后的恢复，以及订阅后端重启后的自动恢复。面板的浏览器测试见 `dashboard/test/README.md`。
