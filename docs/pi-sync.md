# 同步 pi 配置快照

把本机全局配置同步进本仓库的**公开快照**。

```
本机 ~/.pi/agent/  →  仓库 pi/agent/
```

给 **agent** 的契约：按下面的收录范围同步，不要整目录 `cp -r`。

本文只讲 **本机 → 仓库**。把仓库配置装到本机见 [pi-install.md](pi-install.md)，不要和同步混用。

## 目的

仓库 `pi/agent/` 是可公开的配置快照，不是本机目录的完整镜像。同步是为了把角色、技能、扩展、提示词等可共享改动收进仓库。

## 同步什么

覆盖仓库里对应的可共享内容（目录整棵替换，文件整份覆盖）：

| 来源（本机） | 写入（仓库） |
|--------------|--------------|
| `Actor/` | `pi/agent/Actor/` |
| `Domain/` | `pi/agent/Domain/` |
| `Stack/` | `pi/agent/Stack/` |
| `agents/` | `pi/agent/agents/` |
| `extensions/` | `pi/agent/extensions/` |
| `skills/` | `pi/agent/skills/` |
| `prompts/` | `pi/agent/prompts/` |
| `AGENTS.md` | `pi/agent/AGENTS.md` |
| `APPEND_SYSTEM.md` | `pi/agent/APPEND_SYSTEM.md` |
| `settings.json` | `pi/agent/settings.json` |
| `preloop-gate.json` | `pi/agent/preloop-gate.json` |
| `models-store.json` | `pi/agent/models-store.json` |
| `bin/` 中非 `.exe` 文件 | `pi/agent/bin/` |
| `npm/.gitignore` | `pi/agent/npm/.gitignore` |

## 不同步

这些留在本机，**不要写入仓库、不要覆盖仓库里已有的对应文件**：

| 本机文件 | 原因 |
|----------|------|
| `auth.json` | API key |
| `models.json` | 私有模型供应商与模型清单 |
| `trust.json` | 本机路径，不能公开 |
| `sessions/` | 会话记录 |
| `npm/node_modules/` | 可重装 |
| `bin/*.exe` | 本机二进制 |

## 仓库要保留

同步只改 `pi/agent/` 快照，不要删：

| 仓库文件 | 原因 |
|----------|------|
| `pi/agent/auth.json.example` | 仅占位，本机全局目录没有这份 |
| `docs/` | 独立说明文档，不属于全局配置 |
| `install-pi.sh` / `install-pi.ps1` | 安装脚本，不属于全局配置 |

仓库里若已有 `pi/agent/trust.json`，也不要用本机那份覆盖。

## 禁止

- 不要 `cp -r ~/.pi/agent pi/agent`
- 不要把 `auth.json`、`models.json` 拷进仓库或提交
- 不要把本机 `sessions/`、`node_modules/`、`*.exe` 带进快照
- 不要用 `install-pi.*` 做这件事：安装脚本是仓库 → 本机，方向反了

## 验收

同步后检查：

- 可共享目录/文件与本机 `~/.pi/agent` 一致（排除上表「不同步」项）
- 仓库工作区没有 `pi/agent/auth.json`、`pi/agent/models.json`
- `pi/agent/auth.json.example` 仍在
- `git status` 里不应出现被 `.gitignore` 挡住的密钥和运行时目录
