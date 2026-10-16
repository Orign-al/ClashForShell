#!/usr/bin/env python3
"""Create/update the default Sub-Store subscription and all collection."""
from __future__ import annotations

import json
import pathlib
import urllib.parse
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
BASE = "http://127.0.0.1:23001"


def env_value(name: str) -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.partition("=")[2].strip().strip('"').strip("'")
    return ""


def request(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read())


def upsert(kind: str, name: str, payload: dict) -> None:
    current = request(f"/api/{kind}").get("data", [])
    exists = any(item.get("name") == name for item in current)
    if exists:
        singular = kind[:-1]
        request(f"/api/{singular}/{urllib.parse.quote(name)}", "PATCH", payload)
    else:
        request(f"/api/{kind}", "POST", payload)


def main() -> None:
    url = env_value("SUBSCRIPTION_URL")
    if not url:
        print("未设置 SUBSCRIPTION_URL，跳过 Sub-Store 预置；可直接在网页中添加订阅。")
        return
    last_error: Exception | None = None
    for _ in range(20):
        try:
            upsert(
                "subs",
                "origin-al",
                {
                    "name": "origin-al",
                    "displayName": "origin-al 订阅",
                    "source": "remote",
                    "url": url,
                },
            )
            upsert(
                "collections",
                "all",
                {
                    "name": "all",
                    "displayName": "全部节点",
                    "subscriptions": ["origin-al"],
                },
            )
            print("Sub-Store 默认订阅和 all 集合已就绪。")
            return
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1)
    raise SystemExit(f"Sub-Store 初始化失败：{last_error}")


if __name__ == "__main__":
    main()
