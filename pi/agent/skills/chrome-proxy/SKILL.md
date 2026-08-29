---
name: chrome-proxy
description: Fetch a URL through the current Chrome proxy only when the host is clearly 外网 (Google, GitHub, npmjs, x.com, overseas docs) or a direct curl/fetch already timed out/failed. Do not use for 国内 sites, localhost, or as the default HTTP client.
---

# Chrome Proxy Fetch

按 **当前 Chrome 路由**（无忧行 PAC → 系统代理 → 环境变量 → 本地 Clash 端口）拉页面。主会话、subagent、任意带 `bash` 的 agent 都可以用。

## 什么时候用

只在下面两种情况用，其它请求不要读本 skill、不要跑脚本：

1. **已经识别是外网**：主机名一看就是墙外，例如 `google.com` / `github.com` / `npmjs.com` / `x.com` / `openai.com` / `anthropic.com` 及同类海外文档站。这时直接走脚本，不要先裸 `curl` 空等超时。
2. **直连已经失败**：普通 `curl`/`fetch` 超时、连接重置、空响应。失败一次后再改走本脚本。

不要用：

- 国内站（`*.cn`、`*.com.cn`、百度 / 腾讯 / 阿里 / 华为 / Gitee / 掘金 等）
- localhost、内网、本地文件
- 默认当 HTTP 客户端（先直连能通就不要上代理）

## 脚本

路径（相对本 skill 目录）：`scripts/chrome-proxy.mjs`

```text
$HOME/.pi/agent/skills/chrome-proxy/scripts/chrome-proxy.mjs
```

依赖：本机 `node` + `curl`。先 `read` 本文件再跑，不要自己猜 `curl -x`。

拉页面：

```bash
node "$HOME/.pi/agent/skills/chrome-proxy/scripts/chrome-proxy.mjs" --fetch 'https://www.google.com'
```

只解析、不发请求：

```bash
node "$HOME/.pi/agent/skills/chrome-proxy/scripts/chrome-proxy.mjs" www.google.com
node "$HOME/.pi/agent/skills/chrome-proxy/scripts/chrome-proxy.mjs" --json www.google.com
```

`--fetch` 成功时 stdout 是正文，路由在 stderr。失败时 stdout 以 `FETCH_FAILED` 开头。

## 路由优先级

1. Chrome 无忧行 PAC
2. Windows 系统代理（`ProxyEnable=1`）
3. `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
4. 本机 7890 / 7897 / 10809 / 10808 / 1080 …
5. 直连

localhost / 127.0.0.1 / `*.local` 永远直连。

不要把解析出的代理 URL 写进 commit、changelog 或长篇报告。

## 规则

- 只读：不改文件、不改 Chrome、不改系统代理。
- 正文太长只摘相关段落。
- MCP 若能搜到 URL，真正拉外网页面仍按上面两条触发条件决定是否走本脚本。
