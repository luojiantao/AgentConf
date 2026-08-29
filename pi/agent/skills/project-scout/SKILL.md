---
name: project-scout
description: Use the subagent tool with scout (or parallel scouts) to search and gather code, docs, APIs, and architecture context from the CURRENT project without filling the main conversation. Use when you need to find files, trace implementations, collect reference material, or answer "where is X in this repo" before editing.
---

# Project Scout

在**当前项目**里查资料、找代码、摸结构时用这个 skill。通过 `subagent` 把侦察工作丢给隔离的 scout，主会话只拿压缩结果，不要自己大面积 `grep`/`read` 把上下文撑满。

工作目录永远是当前会话 cwd（当前项目）。不要跑到别的仓库。

## 前置

必须有 `subagent` tool。没有的话停下来告诉用户：扩展未加载，执行 `/reload`，或确认 `~/.pi/agent/extensions/subagent/index.ts` 存在。

可用 agent 应包含 `scout`（来自 `~/.pi/agent/agents/scout.md`）。不要用 `agentScope: "project"`，除非用户明确要求项目级 agent。

## 怎么调

只走 `subagent`，三种里选一种。`cwd` 省略（默认当前项目）。

### 一个问题：single scout

适合「找一个功能 / 一套 API / 一个模块」。

```
subagent
  agent: scout
  task: <具体要找什么、交回什么>
```

### 多个独立问题：parallel scouts

适合互不依赖的几路侦察（例如一边 models、一边 providers）。最多 8 路。

```
subagent
  tasks:
    - agent: scout
      task: <问题 A>
    - agent: scout
      task: <问题 B>
```

### 先找再规划：chain

只在用户还要「根据找到的东西出方案、且先不要改代码」时用。查资料本身不要上 worker。

```
subagent
  chain:
    - agent: scout
      task: <在当前项目找出与 X 相关的代码和文档>
    - agent: planner
      task: 根据以下侦察结果，为「<用户目标>」写出只读计划，不要改代码。\n{previous}
```

查资料默认 **不要** 用 worker，避免子 agent 改文件。

## 写给 scout 的 task

必须写清，scout **看不到主对话**。每一条 task 都要自包含，并固定范围在当前项目：

- 目标：要回答什么 / 要收集什么
- 范围：当前仓库；点名目录或模块（如 `packages/coding-agent`）如果已知
- 排除：`node_modules`、`dist`、lockfile、生成代码
- 交回格式：沿用 scout 的 Files Retrieved / Key Code / Architecture / Start Here
- 深度：quick / medium / thorough（默认 medium）

好的 task：

```
在当前项目中找出 session compaction 的实现。
范围：packages/agent 与 packages/coding-agent。
排除 node_modules 和 dist。
交回：关键文件+行号、核心函数签名、调用链、从哪读起。
深度：medium。
```

坏的 task：「帮我看看代码」「搜一下」。

## 拿到结果之后

1. 把 scout 的压缩结论当主依据；**不要**把 scout 已读过的整文件再读一遍，除非要改那个文件，或结论缺了关键行。
2. 对用户用中文简述：找到了什么、在哪些文件、下一步建议。
3. 需要引用代码时，用 scout 给的路径和行号，必要时再 `read` 那一小段。
4. 资料仍不够：再开一轮 scout，task 里写明「已知道 A/B，还缺 C」，不要重复同一搜索。

## 什么时候不要用

- 用户已经给出准确文件路径，读那一个文件就够
- 改一个你已经看过的小范围
- 只是跑测试 / 改几行，不需要侦察

## 失败怎么处理

- `Available agents: none`：用户级 agents 没装好，提示检查 `~/.pi/agent/agents/scout.md`
- 模型找不到（如写死的 `claude-haiku-4-5`）：告诉用户改 `~/.pi/agent/agents/scout.md` 的 `model:`，或删掉该行以继承当前模型，然后重试
- scout 超时/中止：缩小范围或改成 parallel 拆问，不要改由主会话全库扫描
