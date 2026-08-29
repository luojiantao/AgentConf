# AgentConf

记录各类 agent 的**可公开**全局配置。当前先放 pi。

本仓库只收录可共享内容（角色、技能、扩展、提示词等），**不收录密钥、私有模型和本机运行时数据**。

## 目录

| 路径 | 说明 |
|------|------|
| `pi/agent/` | pi 全局配置快照，对应本机 `~/.pi/agent/` |
| `pi/INSTALL.md` | 安装 pi：给 agent 的契约，只跑脚本、不要手拷 |
| `install-pi.sh` / `install-pi.ps1` | 唯一安装动作 |

安装 pi 请读 [pi/INSTALL.md](pi/INSTALL.md)。

## 不收录

| 文件 | 原因 |
|------|------|
| `auth.json` | API key |
| `models.json` | 私有模型供应商与模型清单 |
| `sessions/` | 会话记录 |
| `npm/node_modules/` | 可重装 |
| `bin/*.exe` | 本机二进制 |

密钥字段结构见 `pi/agent/auth.json.example`（仅占位）。
