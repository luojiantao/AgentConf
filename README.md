# AgentConf

记录各类 agent 的**可公开**全局配置。当前先放 pi。

本仓库按公开项目处理：只收录角色、技能、扩展、提示词等可共享内容，**不收录密钥、私有模型和本机运行时数据**。

## 目录

| 路径 | 对应本机 | 说明 |
|------|----------|------|
| `pi/agent/` | `~/.pi/agent/` | pi-coding-agent 全局配置快照（已剔除私人文件） |

## 明确不收录

以下文件含私人信息，**已从仓库中删除**，并由 `.gitignore` 阻止再次提交：

| 文件 | 原因 |
|------|------|
| `pi/agent/auth.json` | 含各 provider 的 API key，不能出现在公开仓库 |
| `pi/agent/models.json` | 含私有模型供应商、baseUrl 和模型清单，属于个人接入配置 |

本机若需要这些文件，请放在 `~/.pi/agent/`，不要拷进本仓库。

密钥文件的字段结构可参考 `pi/agent/auth.json.example`（仅占位，无真实 key）。

## 其它已忽略的运行时内容

- `pi/agent/sessions/`：会话记录
- `pi/agent/npm/node_modules/`：可从 `package.json` 重装
- `pi/agent/bin/*.exe`：本机二进制
