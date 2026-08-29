# Godot · AI 协作开发

本文说明 **多角色 AI 怎么配合做 Godot 相关工作**。它是领域方法，不是角色定义，也不是 GDScript 写法手册。

- 角色怎么判断：`Actor/`
- Godot 4 游戏怎么写：`Stack/godot.md`
- 提示词怎么拆：`Domain/AIUse/AI提示词六要素设计指南.md`
- 这一款游戏的私有事实：`{游戏项目}/.pi/knowledge/`

一次任务只加载与当前阶段相关的角色、栈和本文件需要的章节。不要整目录注入。

## 1. 先分清在做什么

Godot 相关工作有两条线，**不能混用同一套栈和同一组验收**。

| 线 | 仓库长什么样 | 用什么栈 | 默认角色 |
|---|---|---|---|
| **做游戏** | 有 `project.godot`、`.tscn`、`.gd` | `Stack/godot.md`（Godot 4 + 标准编辑器 + GDScript） | `game-designer` → `interface` / `architect` → `developer` → 校验 / 试玩 |
| **改引擎** | 有 `SConstruct`、`version.py`、`core/`、`editor/` | **不要**套 `Stack/godot.md`。以该仓库 `CONTRIBUTING.md`、现有 C++ 写法和当前 tag 为准 | `architect`（模块边界）→ `developer`（最小改动）→ `code-requirement-verifier` |

判断规则：

- 当前目录是引擎源码（如独立 clone 的 `godot`），却在改玩法场景 → 停，先问 master 游戏项目在哪。
- 当前目录是游戏项目，却去改引擎 C++ → 停。游戏需求默认用脚本、场景、资源解决。
- 编辑器二进制 ≠ 引擎源码。运行、试玩、导出用官方 Standard 编辑器；只有「引擎本身要变」才动源码仓库。
- 游戏项目锁定的小版本，必须和用来打开它的编辑器一致。版本以游戏 `project.godot` 的 `config/features`、编辑器 `--version`、引擎仓库 `version.py` / git tag 三者核对，不以记忆为准。

引擎源码工作还缺一份 C++ / SCons 的 `Stack` 文件。在补齐之前，改引擎只跟当前仓库代码和官方贡献说明走，禁止把游戏栈里的 GDScript 约定套到引擎上。

## 2. 六要素怎么装到 Godot 上

```text
可复用 = Role + TechStack + Domain
这一次 = Requirement + Constraints + Acceptance
```

| 要素 | Godot 里放什么 | 不放什么 |
|---|---|---|
| `Role` | 当前阶段用哪个 `Actor` | 节点类名、Godot 版本、这局怎么赢 |
| `TechStack` | Godot 4.x、Standard、GDScript、2D/3D 节点族 | 玩家幻想、关卡名、这一次改哪个场景 |
| `Domain` | 本文件的协作方法；跨项目仍成立的玩法/场景概念 | 某游戏的 Autoload 名、主场景路径 |
| `Requirement` | 这一次要变成什么可观察行为 | 「更好玩」「优化一下」 |
| `Constraints` | 允许改哪些场景/脚本、不动引擎、不升级大版本 | 把约束写成空话「不影响其他功能」 |
| `Acceptance` | 代码证据、能跑的一局、失败是否可读 | 「感觉对了」 |

冲突时按 `AIUse` 的优先级：仓库安全规则 → 本次 Constraints → Requirement → Acceptance → Stack/Domain → 角色偏好。

## 3. 角色怎么配合

主角色永远只有一个。阶段变了再切，不要一个人同时设计、实现、验收。

```text
幻想 / 循环 / 动词 / 胜负     → game-designer
数据归谁、Autoload、存档、联机 → architect
菜单 / HUD / 空态失败可恢复   → interface
改 .gd / .tscn / .tres        → developer + Stack/godot.md
需求有没有代码证据            → code-requirement-verifier
这一局体验有没有发生          → playtester
```

### 3.1 默认流水线（做游戏）

1. **game-designer**：写出幻想、最短核心循环、动词与代价、胜负、失败怎么读。交不出循环，不准开工。
2. **architect**（仅当需要）：Autoload 是否该有、存档归谁、场景实例所有权、联机权威、失败半径。小功能不要升格成架构案。
3. **interface**（仅当需要）：人怎么走进去、看见什么、走完、做错怎么回。不画视觉规范，不写控件实现。
4. **developer**：按现有场景树做最小改动。场景和脚本放一起。不发明玩法，不顺手重构。
5. **code-requirement-verifier**：只认可达的实现证据，不认注释、文档、测试文件本身。
6. **playtester**：对着可玩对象走剧本。只认时刻证据，不认「代码里有这个函数」。

`developer` 不能代替 1–3 的判断，也不能用实现冒充 5–6 的验收。两条验收线互不替代：

- 校验员：需求条款 ↔ 代码
- 试玩：设计意图 ↔ 玩家这一局经历到的事

### 3.2 什么任务走哪条短路径

| 任务 | 主角色 | 可以跳过 | 不能跳过 |
|---|---|---|---|
| 新核心玩法 | `game-designer` 起，`developer` 落 | 无新边界时可跳过 `architect` | 循环未闭合就写代码 |
| 只改菜单/HUD/提示 | `interface` → `developer` | `game-designer`（除非决策信息变了） | 空态/失败/返回 |
| 行为 bug、脚本报错 | `developer` | 设计角色 | 复现路径和改后观察点 |
| 存档、Autoload、联机同步 | `architect` → `developer` | 把全局单例当默认方案 | 数据所有权 |
| 「需求做完了吗」 | `code-requirement-verifier` | 试玩 | 改代码 |
| 「这局成立吗」 | `playtester` | 代码审查 | 无可玩对象却写「已验收」 |
| 改引擎模块 | `architect`（边界）→ `developer` | 游戏角色 | 套 GDScript 游戏栈 |

### 3.3 切换条件（Godot 现场）

- 准备新增 Autoload、改存档格式、加网络权威 → 停 `developer`，转 `architect`。
- 准备加一整套技能/背包/成长，但循环还没写闭合 → 停，转 `game-designer`。
- 卡在「玩家看不懂下一步、点完回不去」 → 转 `interface`，不要先加更多按钮。
- 功能在代码里，但走一局没有反馈或失败不可读 → 交给 `playtester` 定性后，再回到对应角色。
- 游戏项目里出现 `.cs` / Godot .NET → 停，不要套当前 `Stack/godot.md`。

## 4. 场景树是协作的共同语言

各角色说话时，用场景树事实，不靠印象。

| 角色 | 允许谈的对象 | 禁止越界 |
|---|---|---|
| `game-designer` | 玩家是谁、反复做什么、输了下次试什么 | 节点类名、信号名、目录结构 |
| `architect` | 谁拥有玩家状态、关卡实例谁生成谁释放、失败炸多大 | 点名用 Dictionary 还是 Resource 当唯一理由 |
| `interface` | 从进入到完成的步骤、空/加载/失败/成功 | 写 `Control` 布局代码、挑主题皮肤 |
| `developer` | 现有 `.tscn` / `.gd` / `InputMap` / Autoload | 擅自加全局单例、改主场景入口、引入 C# |
| `playtester` | 第几步看见什么、按了什么、局面变没变 | 改数值冒充设计、用测试通过代替试玩 |
| `code-requirement-verifier` | 入口是否接到信号/物理/输入、结果是否到达出口 | 运行游戏、改文件 |

开发落地时的共同约束（由 `developer` + `Stack/godot.md` 执行，其它角色只要求结果）：

- 一个功能：`foo/foo.tscn` + `foo/foo.gd`，不要把脚本丢进扁平 `scripts/`，除非仓库已经这样。
- 纯数据用 `Resource`，有位置和生命周期的用节点。
- 玩法输入走 `InputMap` 动作名。
- 跨场景引用用 `@export` 或唯一名 `%Node`，禁止 `get_parent().get_parent()`。
- 2D 物理世界和 3D 物理世界不混在同一套玩法里。
- Autoload 只放真正全局的东西。关卡状态、玩家当前血量默认不是全局。

## 5. 项目知识写什么

全局 Domain / Stack **禁止**写某一款游戏的私有事实。这些放到 `{游戏项目}/.pi/knowledge/`：

- 编辑器路径、精确版本（例如 4.7.2.stable）、是否 Standard。
- 主场景、当前能玩的入口场景。
- Autoload 清单和各自职责。
- `InputMap` 动作名。
- 已锁定的幻想、动词、胜负。
- 2D 还是 3D、像素还是透视。
- 导出平台、是否联机。
- 「不要动」的目录和第三方插件。

没有这些就问 master，不准用「这类游戏一般都这样」补。

引擎仓库不要把个人 AI 文档提交进官方源码树。个人约定放全局 `Domain/` / `Stack/`，或仓库本地 `.pi/`（且不要推进 Godot 上游）。

## 6. 一次任务怎么开口

Master 给任务时，尽量带齐「这一次」三要素。AI 缺了就问，不靠猜开工。

```text
Role：按阶段选，不要一次点全部角色
TechStack：Godot 4 Standard GDScript（游戏）/ 当前引擎 tag（改引擎）
Domain：本文件 + 项目 knowledge 里相关几条
Requirement：现在怎样 → 要变成怎样（玩家或调用方能看见）
Constraints：哪些场景/脚本可改，哪些禁止，是否允许动 Autoload / project.godot
Acceptance：怎么失败算没做完（代码证据 + 一局时刻，按任务选）
```

推荐的需求句式：

```text
在【场景/入口】里，玩家【做某动作】之后，【局面变成什么】。
失败时【看见什么、能怎么再试】。
不要改【清单】。
用【编辑器版本】打开【主场景或指定场景】验证。
```

不要用的句式：「做个类似 XX 的游戏」「先把框架搭好」「顺便重构」「更好玩一点」。

## 7. 分阶段交付物

每一阶段交出手里该有的东西，缺了不准进入下一阶段。

### game-designer

- 一句话幻想
- 最短循环：动作 → 反馈 → 变化 → 再行动
- 动词表（含本局明确没有的动词）
- 胜负与失败可读性
- 前几次有效决策各教一件事
- 至少两套方案（必须含「少一个系统」的那套）

### architect

- 要保护什么、会怎么坏
- 数据所有权（玩家/关卡/存档/网络）
- 两套结构（含「少拆一块」）
- 现在选哪套、什么信号出现才再拆

### interface

- 用户这一次要做成的一件事
- 主路径逐步决定
- 空 / 加载 / 失败 / 无权 / 成功
- 顺利、失败、误操作三条走查

### developer

- 可观察行为差
- 改了哪些 `.gd` / `.tscn` / `.tres` / `project.godot`，没改哪些
- 验证步骤和结果
- 发现但刻意不碰的味道

### code-requirement-verifier

- 需求拆成原子条款
- 每条：已完成 / 部分完成 / 未完成 / 无法确认
- 代码位置和最短证据链
- 不改文件

### playtester

- 本局要证明的体验意图
- 操作剧本
- 时刻记录
- 成立 / 部分成立 / 不成立 / 无法确认
- 不成立时交回哪个角色

## 8. 验收梯子

按任务选梯子，不要跳级宣布完成。

1. **静态**：相关脚本有类型注解；场景能打开；入口仍是原主场景（除非需求就是改入口）。
2. **代码证据**：`code-requirement-verifier` 能从输入（动作、信号、点击）追到出口（位移、UI 文本、场景切换、存档）。
3. **能跑**：用锁定版本的 Standard 编辑器打开项目。能无窗口跑的，用 `--headless` / `--quit` 做冒烟；不能的，写明手工步骤。
4. **一局成立**：`playtester` 按剧本走完最短有效一局。功能在、体验不成立，仍算这一阶段没完。

改引擎时第 4 步换成：目标编辑器行为的复现步骤 + 构建产物版本号与改动说明。不要用「游戏手感」验收引擎补丁。

## 9. 明确禁止

- 用游戏项目的 AI 去改引擎源码，或把引擎仓库当游戏内容目录。
- 在游戏里新增 C# / `.cs` / .NET 编辑器。
- 未写循环就加背包、技能树、成就、商店。
- 用 Autoload 堆玩家、敌人、当前关卡的全部状态。
- 把 `playtester` 的「不好玩」和校验员的「代码没有」写成同一条结论。
- 无可玩对象时宣称已经试玩通过。
- 为了让 AI 方便，把所有脚本改成无类型，或关掉 GDScript 类型警告。
- 把 Unity 的 `Update` / `GameObject.Find` / 场景加载习惯搬进 Godot。
- 个人 AI 文档推进 Godot 官方源码的 git 历史。

## 10. 加载清单（给执行 AI）

开始 Godot **游戏**任务时，按需读取，不要全读：

1. 本文件（协作边界和阶段）
2. 当前主角色的 `Actor/{id}.md`
3. `Stack/godot.md`（以及项目 `.pi/Stack/godot.md` 若存在）
4. `{项目}/.pi/knowledge/` 里与本任务相关的条目
5. 当前要改的场景、脚本、`project.godot` 相关段

开始 **引擎**任务时：

1. 本文件第 1、3.2、8、9 节
2. `architect` 或 `developer` 角色文档
3. 仓库 `CONTRIBUTING.md`、`version.py`、目标模块现有代码
4. 不要加载 `Stack/godot.md` 当实现规范
