# Stack · 技术栈层（全局为主，项目可覆盖）

本目录是**全局默认**：跨项目复用的语言 / 框架 / 中间件约定和易错点。

```
全局  C:\Users\41290\.pi\agent\Stack\{id}.md     ← 通用
项目  {项目根}/.pi/Stack/{id}.md                 ← 本仓库版本与写法，覆盖同名全局
```

不是角色，也不是 `../skills`（agent 操作技能）。业务知识不要写在这里，也不要写在全局 agent 目录。

| 文件 | 说明 |
|------|------|
| [_template.md](./_template.md) | 新技术栈空白骨架，不要当知识注入 |
| [godot.md](./godot.md) | Godot 4 + 标准版编辑器 + GDScript（已锁定，不用 C# / .NET） |

命名：小写 + 连字符，如 `java.md`、`spring-boot.md`、`go.md`。一次任务只加载真正会用到的文件。同名时项目覆盖全局。
