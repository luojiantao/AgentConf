# 安装 pi 配置

给 **agent** 的安装契约。动作只有跑脚本；不要按目录手拷。

仓库快照：`pi/agent/`  
本机目标：`~/.pi/agent/`（可用 `PI_CODING_AGENT_DIR` 或脚本 `--dest` 覆盖）

本文只讲 **仓库 → 本机**。把本机配置收进仓库见 [pi-sync.md](pi-sync.md)，不要和安装混用。

## 命令

在仓库根目录执行。

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-pi.ps1
```

Git Bash / macOS / Linux：

```bash
./install-pi.sh
```

常用参数：

| 参数 | 作用 |
|------|------|
| `--skip-cli` | 只写入配置，不重装 pi CLI |
| `--dry-run` | 只打印将要做的事，不改本机 |
| `--dest DIR` | 写入指定目录，而不是 `~/.pi/agent` |

本机已有 pi CLI、只需刷新配置时用 `--skip-cli`。不确定时先 `--dry-run`。

## 禁止

- 不要手拷 `pi/agent` 到本机全局目录
- 不要改脚本，让它顺便带上 `auth.json` 或 `models.json`
- 不要把 `auth.json`、`models.json` 提交进本仓库
- 不要另写一套「先拷 Actor、再拷 skills」的安装步骤
- 脚本坏了再修脚本；不要用手工拷贝当安装路径
- 不要用安装脚本做本机 → 仓库；那是 [pi-sync.md](pi-sync.md)

## 前置

- 本机有 `node` 和 `npm`
- 在本仓库根目录运行脚本

## 脚本会做

1. 安装 `@earendil-works/pi-coding-agent`（`--skip-cli` 时跳过）
2. 把 `pi/agent/` 里可公开内容写入目标目录
3. 按目标目录 `settings.json` 的 `packages` 执行 `pi install`

安装时会覆盖目标里的可共享配置（角色、技能、扩展、提示词、`settings.json` 等）。

## 脚本不会做 / 不会覆盖

| 本机文件 | 行为 |
|----------|------|
| `auth.json` | 不拷、不覆盖 |
| `models.json` | 不拷、不覆盖 |
| `trust.json` | 不拷、不覆盖 |
| `sessions/` | 不拷、不覆盖 |
| `bin/*.exe` | 不拷 |
| `npm/node_modules/` | 不从仓库拷；由 `pi install` 生成 |

## 验收

装完后检查：

- 目标目录里有 `Actor/`、`skills/`、`extensions/`、`agents/`、`AGENTS.md`
- 若本机原先已有 `auth.json`、`models.json`、`trust.json`、`sessions/`，内容仍在、未被仓库文件替换
- `bin/` 下没有从本仓库拷来的 `*.exe`
- `settings.json` 里的 packages 已能被 `pi` 加载（当前为 `npm:pi-mcp-adapter`）

## 脚本不做的事

这些必须留在本机，仓库不收录：

- 填写 `~/.pi/agent/auth.json`：可从目标目录的 `auth.json.example` 复制后填 key，或运行 `pi` 后 `/login`
- 编写 `~/.pi/agent/models.json`：自定义 provider / 模型清单
