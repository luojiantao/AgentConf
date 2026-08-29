---
description: 在 pi.dev/packages 按描述查找相关 extension / skill / prompt / theme
argument-hint: "[extension|skill|prompt|theme] <description>"
---
在官方目录 https://pi.dev/packages 查找和下面需求相关的 Pi package（extension / skill / prompt / theme）。

需求：${@:-当前对话里 master 刚描述的任务或缺口}

不要凭印象推荐。必须实际检索页面，用检索结果说话。不要把 5000+ 包的全量目录拉下来。不要擅自执行 `pi install`。

## 检索规则

1. 从需求里抽出 1～3 组检索词。目录条目几乎都是英文：中文需求先译成英文关键词（如 子代理→subagent，记忆→memory，待办→todo，审查→review，MCP→mcp），必要时再补中文原词。
2. 若 `$1` 是 `extension` / `skill` / `prompt` / `theme` 之一，把它当作 `type`，其余参数当描述；否则不传 `type`。
3. 对每组词请求：
   - `https://pi.dev/packages?name=<urlencoded>&sort=downloads`
   - 指定了 type 时追加 `&type=<type>`
4. 先直连 `curl`（超时 20s，UA 用 Mozilla）。失败或超时再读 chrome-proxy skill，用它的脚本拉外网。
5. 保存 HTML 到临时文件，用 node 解析卡片，不要肉眼扫整页 HTML。
6. 首页不够再看 `packages-count`（形如 `1-50 / N`）。只在前两页仍明显相关时才翻 `page=2`。换关键词优于盲翻页。
7. 按包名去重。相关度：名字精确匹配 > 描述/关键词匹配 > 下载量。同能力多包时保留下载量高、最近有更新的。
8. 前 3 个候选再打开详情页 `https://pi.dev/packages/<name>`，核对 README 摘要和 Pi manifest（extensions/skills/prompts/themes）。对不上需求的划掉。

解析脚本示例（把 HTML 路径当参数）：

```js
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const count = (html.match(/packages-count[^>]*>([^<]+)/) || [])[1] || "";
const rows = [...html.matchAll(/<article class="surface-panel content-card" data-package-card="true"([\s\S]*?)<\/article>/g)].map((m) => {
  const b = m[1];
  const attr = (n) => (b.match(new RegExp(`data-package-${n}="([^"]*)"`)) || [])[1] || "";
  return {
    name: attr("name"),
    types: attr("types"),
    downloads: Number(attr("downloads") || 0),
    desc: (b.match(/class="packages-desc">([^<]*)/) || [])[1] || "",
    author: (b.match(/class="packages-meta"><span>([^<]*)/) || [])[1] || "",
    install: `pi install npm:${attr("name")}`,
    url: `https://pi.dev/packages/${encodeURIComponent(attr("name")).replace(/%40/g, "@")}`,
  };
});
console.log(JSON.stringify({ count, rows }, null, 2));
```

## 输出

先给结论，再给列表。默认最多 8 条，按相关度排序，分组：extension / skill / prompt / theme / 其它 package。

每条写：

- 包名（链接到 `https://pi.dev/packages/<name>`）
- 类型、作者、月下载量
- 一句话：它解决需求的哪一块
- 安装：`pi install npm:<name>`

最后补 3 件事：

- 为什么这些包匹配，以及明显更差/已排除的近邻
- 安全：第三方 Pi package 有完整系统权限，安装前要看源码；这次只推荐，不安装
- 若目录里没有真正对口的包，直说没有，不要硬凑

目录空结果时，不要改搜无关 npm 包。可以再换 1 组同义英文词重试；仍没有就停止。
