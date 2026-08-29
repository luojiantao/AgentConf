# Actor · 角色层（只全局）

本目录只放**角色**。路径固定：`C:\Users\41290\.pi\agent\Actor`。不要在项目里再放一份 Actor 来覆盖。

```
系统上下文（AGENTS.md）
  + 角色（本目录：怎么想、怎么做）          ← 只全局
  + 技术栈（Stack/：这次用什么实现）        ← 全局为主，项目 .pi/Stack 可覆盖
  + 领域知识（Domain/：跨项目仍成立）      ← 全局
  + 项目知识（只当前仓库私有事实）         ← {项目}/.pi/knowledge/，禁止写入全局
  + 需求（这一次要完成的事）
```

| 层 | 回答的问题 | 放哪里 | 不放什么 |
|----|------------|--------|----------|
| 系统 | 我是谁、对 master 什么态度 | 全局 `AGENTS.md` | 专业方法论 |
| 角色 | 这类人怎么判断、按什么流程做事 | **只** `Actor/{id}.md` | 具体技术栈、业务细节 |
| 技术栈 | 这次用什么语言/框架实现 | 全局 `Stack/` + 项目 `.pi/Stack/` | 职业身份、做事顺序 |
| 领域知识 | 跨项目仍成立的领域方法与概念 | 全局 `Domain/` | 某公司服务名、表名、内部流程 |
| 项目知识 | 这个仓库特有的事实 | **只** `{项目}/.pi/knowledge/` 等 | 某门技术的公开文档 |
| 需求 | 此刻要交付什么 | 当前对话 | 长期人设 |

## 现有角色

| 文件 | ID | 用来做什么 |
|------|-----|------------|
| [nuwa.md](./nuwa.md) | `nuwa` | 创造 / 修改本目录里的其他角色 |
| [architect.md](./architect.md) | `architect` | 结构决策：边界、失败、取舍与演进 |
| [developer.md](./developer.md) | `developer` | 把需求落成可验证的最小改动 |
| [interface.md](./interface.md) | `interface` | 界面交互：目标、路径、状态、可恢复 |
| [game-designer.md](./game-designer.md) | `game-designer` | 玩法决策：幻想、循环、动词、胜负、教学 |
| [playtester.md](./playtester.md) | `playtester` | 玩法验收：用一局时刻证据判断体验是否成立 |
| [code-requirement-verifier.md](./code-requirement-verifier.md) | `code-requirement-verifier` | 用代码证据核验需求完成度 |
| [_template.md](./_template.md) | — | 新角色空白模板，不要当角色注入 |

## 用法

**造角色**：把 `nuwa.md` 放进上下文，对女娲说「创建一个架构师角色」。产出仍只写到本目录。

**做任务**：

```
系统：全局 AGENTS.md
角色：Actor/architect.md           ← 只含架构判断与设计流程
技术栈：全局 Stack/java.md
       + 项目 .pi/Stack/java.md    ← 有则覆盖同名全局
领域：全局 Domain/                 ← 只加载相关文档
知识：项目 .pi/knowledge/          ← 只当前仓库
需求：给支付模块做拆分方案
```

架构师角色里**不要**写「精通 Java」。Java 是技术栈层，换个任务可以换成 Go。
