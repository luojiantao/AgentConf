# Subagent 使用说明

已安装到本机用户级 pi 目录。重启 pi，或在当前会话执行 `/reload` 后生效。

## 装了什么

| 路径 | 内容 |
|------|------|
| `~/.pi/agent/extensions/subagent/index.ts` | 注册 `subagent` tool |
| `~/.pi/agent/extensions/subagent/agents.ts` | 扫描 agent 定义 |
| `~/.pi/agent/agents/*.md` | scout / planner / reviewer / worker / docs / agent-continue 等用户级 agent |
| `~/.pi/agent/prompts/*.md` | `/implement`、`/scout-and-plan`、`/implement-and-review` |

原理：普通 agent 调用时，主会话拉起独立的 `pi --mode json -p --no-session` 一次性子进程。配置了 continuation 三字段的专用 agent 改用 `pi --mode rpc --no-session` 持久子进程，并可在同一会话发送扩展命令。两种子 agent 都有自己的上下文，不会污染主对话。`Ctrl+C` / Escape 中止会杀掉子进程。

## 使用前必看：模型

示例 agent 的 frontmatter 写死了 Claude 模型：

| Agent | 默认模型 | 工具 |
|-------|----------|------|
| `scout` | `claude-haiku-4-5` | read, grep, find, ls, bash |
| `planner` | `claude-sonnet-4-5` | read, grep, find, ls |
| `reviewer` | `claude-sonnet-4-5` | read, grep, find, ls, bash（只读） |
| `worker` | `claude-sonnet-4-5` | 全部内置工具 |
| `docs` | `grok-relay/grok-4.6:xhigh` | read, grep, find, ls, bash, mcp, mcpScript（只读 + 联网；外网或直连失败才用 `chrome-proxy` skill） |
| `agent-continue` | `grok-relay/grok-4.6` | 全部默认工具；只接受 `implementation-plan-executor` 委派 |

当前全局默认是 `grok-relay/grok-4.6`。如果本机没有配好对应模型，子进程会起不来。

改法：编辑 `~/.pi/agent/agents/<name>.md` 顶部 YAML：

- 改成你有的模型，例如 `model: grok-4.6`
- 或删掉 `model:` 行，让子 agent **继承当前会话的模型和思考等级**

`tools:` 也可以改。省略 `tools` 表示该 agent 可用全部默认工具（worker 就是这样）。

## 怎么确认装上了

1. 交互里输入 `/`，应能看到 `/implement`、`/scout-and-plan`、`/implement-and-review`
2. 让模型「用 scout 查一下认证相关代码」——应出现 `subagent` tool call
3. 如果报 `Available agents: none`，检查 `~/.pi/agent/agents/` 里是否有任务所需的 agent md

## 方案执行专用 agent

调用：

```text
/skill:implementation-plan-executor Doc/{topic}-implementation-plan.md
```

执行器会使用 `single` 模式创建一个用户级 `agent-continue`，固定模型为 `grok-relay/grok-4.6`。该 agent 使用持久 RPC 子进程；同一次调用的全部目标阶段在同一子会话中执行。每轮 `agent_settled` 后若没有完成或阻塞标记，subagent 运行时会通过 RPC `prompt` 在该会话执行扩展命令 `/agent-continue`，由命令发送 `agent continue` 开始下一轮。

它与用户在主 TUI 手动输入 `/agent-continue` 是同一个扩展命令，但作用于不同会话：这里的命令在 subagent 自己的 RPC 会话内执行，不会继续主会话。目标项目必须已授信并成功加载提供该命令的扩展。

不要直接用自然语言调用该 agent。它只接受带 `IMPLEMENTATION_PLAN_EXECUTOR_DELEGATED=agent-continue-v1` 标记的执行器任务包，并禁止递归创建自己。完成标记是 `<!-- SELF_CONTINUE_DONE -->`；无法继续的阻塞标记是 `<!-- IMPLEMENTATION_PLAN_EXECUTOR_BLOCKED -->`。

## 自然语言用法

直接对主 agent 说即可，它会调 `subagent`：

```
用 scout 找出所有认证相关代码
并行跑 2 个 scout：一个找 models，一个找 providers
按 chain 执行：先 scout 找 read 工具，再 planner 给改进方案
```

## Slash 工作流

这些是 prompt 模板，会指示主模型用 **chain** 调 `subagent`：

```
/implement 给 session store 加 Redis 缓存
/scout-and-plan 把 auth 重构成支持 OAuth
/implement-and-review 给 API 端点加输入校验
```

| 命令 | 流程 | 会不会改代码 |
|------|------|----------------|
| `/implement <需求>` | scout → planner → worker | 会 |
| `/scout-and-plan <需求>` | scout → planner | 不会，只出计划 |
| `/implement-and-review <需求>` | worker → reviewer → worker | 会 |

`$@` 会替换成命令后面的参数。

## `subagent` tool 三种模式

每次调用只能选一种。

### 1. Single

```json
{ "agent": "scout", "task": "找出认证相关代码" }
```

可选 `cwd`：子进程工作目录，默认跟主会话 cwd。

### 2. Parallel

```json
{
  "tasks": [
    { "agent": "scout", "task": "找出 models 相关代码" },
    { "agent": "scout", "task": "找出 providers 相关代码" }
  ]
}
```

限制：最多 8 个任务，最多 4 个并发。返回给主模型的每任务输出上限 50KB（完整结果仍在 tool details）。

### 3. Chain

```json
{
  "chain": [
    { "agent": "scout", "task": "找出 read 工具实现" },
    { "agent": "planner", "task": "根据以下上下文给出改进方案：\n{previous}" }
  ]
}
```

`{previous}` 会替换成上一步的最终文本。任一步失败（非 0 退出、`stopReason` 为 error/aborted）会立刻停，并报告停在第几步。

## 可选参数

| 参数 | 默认 | 含义 |
|------|------|------|
| `agentScope` | `"user"` | `"user"` 只用 `~/.pi/agent/agents`；`"project"` 只用 `.pi/agents`；`"both"` 两边都用，同名时项目覆盖用户 |
| `confirmProjectAgents` | `true` | 交互模式下跑项目级 agent 会先确认 |
| `cwd` | 主会话 cwd | 仅 single 模式的工作目录；parallel/chain 里写在每个 task/step 上 |

项目级 agent 是仓库可控的 prompt，能让模型读文件、跑 bash。默认不加载。只在信任的仓库开 `agentScope: "both"` 或 `"project"`。

## 界面

折叠（默认）：

- 状态：✓ / ✗ / ⏳，以及 agent 名
- 最近若干条工具调用和文本
- 用量：`3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:tokens model`

展开（`Ctrl+O`）：

- 完整 task
- 全部工具调用
- 最终输出按 Markdown 渲染
- chain/parallel 的分任务用量

并行时会显示 `2/3 done, 1 running`。

## 自定义 agent

在 `~/.pi/agent/agents/` 新增 markdown，文件名随意，frontmatter 必须有 `name` 和 `description`：

```markdown
---
name: my-agent
description: 专门做某某事
tools: read, grep, find, ls
model: grok-4.6
continuationCommand: /agent-continue
completionMarker: "<!-- SELF_CONTINUE_DONE -->"
blockedMarker: "<!-- IMPLEMENTATION_PLAN_EXECUTOR_BLOCKED -->"
---

这里是该 agent 的 system prompt。
```

`tools` 写成逗号分隔字符串或 YAML 数组都可以。每次调用都会重新扫描目录，改完不用重启。`continuationCommand`、`completionMarker`、`blockedMarker` 三项同时存在时，该 agent 使用持久 RPC 模式；其他 agent 继续使用一次性 JSON 模式。

项目级同结构，放到 `<repo>/.pi/agents/`，并且调用时带 `agentScope: "both"` 或 `"project"`。

## 限制

- 折叠视图只留最近约 10 条，展开看全文
- 并行模式下主模型可见输出每任务 50KB
- 子进程是全新会话，看不到主对话历史；需要的上下文必须写进 `task`。持久 RPC agent 只在本次 subagent 调用期间保留自己的多轮上下文
- 示例工作流假设 scout/planner/reviewer/worker 都在；删了某个 agent，对应 chain 会失败

## 卸载

```bash
rm -rf ~/.pi/agent/extensions/subagent
rm -f ~/.pi/agent/agents/{scout,planner,reviewer,worker}.md
rm -f ~/.pi/agent/prompts/{implement,scout-and-plan,implement-and-review}.md
```

然后 `/reload` 或重启 pi。
