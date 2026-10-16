#!/usr/bin/env python3
"""Fetch the configured VLESS subscription and update config/config.yaml."""
from __future__ import annotations
import base64
import os
import pathlib
import re
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
CONFIG = ROOT / "config" / "config.yaml"

def load_env() -> str:
    if not ENV.exists():
        raise SystemExit("缺少 .env；请先执行 cp .env.example .env 并填入订阅地址")
    for line in ENV.read_text().splitlines():
        if line.startswith("SUBSCRIPTION_URL="):
            value = line.partition("=")[2].strip().strip('"').strip("'")
            if value:
                return value
    raise SystemExit(".env 中未设置 SUBSCRIPTION_URL")

def yaml_quote(value: str) -> str:
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'

def main() -> None:
    url = load_env()
    request = urllib.request.Request(url, headers={"User-Agent": "mihomo-docker/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    text = raw.decode("utf-8", "replace").strip()
    proxy = None
    if text.lstrip().startswith(("proxies:", "proxy-groups:")):
        try:
            import yaml
            proxy = next((p for p in yaml.safe_load(text).get("proxies", []) if p.get("type") == "vless"), None)
        except Exception as exc:
            raise SystemExit(f"无法解析订阅 YAML：{exc}")
    if proxy is None:
        try:
            decoded = base64.b64decode("".join(text.split()), validate=False).decode("utf-8")
        except Exception:
            decoded = text
        links = [line.strip() for line in decoded.splitlines() if line.strip().startswith("vless://")]
        if not links:
            raise SystemExit("订阅中没有找到 vless:// 节点或 Clash YAML")
        parsed = urllib.parse.urlsplit(links[0])
        query = urllib.parse.parse_qs(parsed.query)
        def q(name: str, default: str = "") -> str:
            return query.get(name, [default])[0]
        if not parsed.hostname or not parsed.port or not parsed.username:
            raise SystemExit("VLESS 节点缺少服务器、端口或 UUID")
        proxy = {
            "name": urllib.parse.unquote(parsed.fragment) or "Mihomo VLESS",
            "server": parsed.hostname, "port": parsed.port, "uuid": parsed.username,
            "network": q("type", "tcp"), "client-fingerprint": q("fp", "chrome"),
            "servername": q("sni") or parsed.hostname, "encryption": q("encryption"),
            "reality-opts": {"public-key": q("pbk"), "short-id": q("sid")},
        }
    name = str(proxy.get("name", "Mihomo VLESS"))
    secret = ""
    if CONFIG.exists():
        match = re.search(r'^secret:\s*"([^"]*)"\s*$', CONFIG.read_text(encoding="utf-8"), re.MULTILINE)
        if match:
            secret = match.group(1)
    if not secret:
        import secrets

        secret = secrets.token_urlsafe(32)
    server = proxy.get("server")
    port = proxy.get("port")
    uuid = proxy.get("uuid")
    if not server or not port or not uuid:
        raise SystemExit("VLESS 节点缺少服务器、端口或 UUID")
    reality = proxy.get("reality-opts") or {}
    public_key = reality.get("public-key", "")
    short_id = reality.get("short-id", "")
    sni = proxy.get("servername") or server
    fingerprint = proxy.get("client-fingerprint", "chrome")
    network = proxy.get("network", "tcp")
    encryption = proxy.get("encryption", "")
    lines = [
        "mixed-port: 27890", "allow-lan: true", "bind-address: 0.0.0.0", "mode: rule",
        "log-level: info", "ipv6: false", "", "external-controller: 0.0.0.0:29090",
        f"secret: {yaml_quote(secret)}", "external-ui: /root/.config/mihomo/ui", "", "profile:", "  store-selected: true", "",
        "dns:", "  enable: true",
        "  ipv6: false", "  enhanced-mode: fake-ip", "  fake-ip-range: 198.18.0.1/16",
        "  nameserver:", "    - 223.5.5.5", "    - 114.114.114.114",
        "  proxy-server-nameserver:", "    - 223.5.5.5", "    - 114.114.114.114",
        "  fallback:", "    - 223.5.5.5", "    - 114.114.114.114",
        "  fallback-filter:", "    geoip: true", "    geoip-code: CN", "", "proxies:",
        f"  - name: {yaml_quote(name)}", "    type: vless",
        f"    server: {server}", f"    port: {port}",
        f"    uuid: {uuid}", "    udp: true", "    tls: true",
        f"    servername: {sni}", f"    network: {network}", f"    client-fingerprint: {fingerprint}",
    ]
    if public_key or short_id:
        lines += ["    reality-opts:"]
        if public_key: lines.append(f"      public-key: {public_key}")
        if short_id: lines.append(f"      short-id: {short_id}")
        if reality.get("support-x25519mlkem768") is True:
            lines.append("      support-x25519mlkem768: true")
    if encryption: lines.append(f"    encryption: {encryption}")
    lines += ["", "proxy-groups:", "  - name: PROXY", "    type: select", "    use:", "      - sub-store", "    proxies:", f"      - {yaml_quote(name)}", "      - DIRECT", "", "proxy-providers:", "  sub-store:", "    type: http", "    url: http://127.0.0.1:23001/download/collection/all?target=ClashMeta", "    path: ./proxy_providers/sub-store.yaml", "    interval: 21600", "    proxy: DIRECT", "    health-check:", "      enable: true", "      interval: 600", "      url: https://www.gstatic.com/generate_204", "", "rules:", "  - GEOSITE,private,DIRECT", "  - GEOIP,private,DIRECT,no-resolve", "  - GEOSITE,cn,DIRECT", "  - GEOIP,CN,DIRECT", "  - MATCH,PROXY", ""]
    CONFIG.write_text("\n".join(lines), encoding="utf-8")
    print(f"已更新 {CONFIG}（当前使用：{name}）")

if __name__ == "__main__":
    main()
