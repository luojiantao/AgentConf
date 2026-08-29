# Domain · 领域知识层（全局可复用）

本目录放**跨项目仍成立**的领域方法与概念。路径：`C:\Users\41290\.pi\agent\Domain`。

项目私有事实不要写在这里，放到 `{项目根}/.pi/knowledge/`。

```
全局  C:\Users\41290\.pi\agent\Domain\<topic>\...     ← 可复用
项目  {项目根}/.pi/knowledge/                         ← 本仓库专有
```

不是角色，也不是 `../Stack`。一次任务只加载真正相关的文档，不要整目录注入。

| 路径 | 说明 |
|------|------|
| [AIUse/](./AIUse/) | 提示词六要素：Role / TechStack / Domain / Requirement / Constraints / Acceptance |
| [AIUse/源码修改执行方案模板.md](./AIUse/源码修改执行方案模板.md) | 给 AI / 工程师直接改代码的执行方案空模板；`$ai-plan-doc-writer` 按同名 skill 内副本填写，两处必须同步 |
| [Godot/AI协作开发.md](./Godot/AI协作开发.md) | 多角色 AI 怎么配合做 Godot 游戏 / 改引擎；不替代 `Stack/godot.md` 与 `Actor/` |
