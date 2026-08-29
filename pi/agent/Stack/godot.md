# Godot/godot

用 Godot 4 场景树、节点、资源和 GDScript 实现可运行的 2D/3D 游戏。

## 选用

这套栈已锁定：**Godot 4.x + 标准版编辑器 + GDScript**。不是 3.x，不是 .NET 版，不是 C#，不是其它引擎的 C# API。

- 编辑器下 **Standard**。不要下 .NET / Mono 版。新项目在管理器里选 GDScript，不要选 C#。
- 实现时和 `developer` 一起用：角色管「改什么行为」，本文件管「在 Godot 里怎么改」。`game-designer` / `interface` / `playtester` 不靠本文件做判断。
- 仓库若是 Godot 3、Godot .NET 或已有 `.cs` 玩法代码：不要套本文件。用项目 `.pi/Stack/godot.md` 覆盖，或先停下来问 master。
- 2D 用 `Node2D` / `CharacterBody2D` / `Control`；3D 用 `Node3D` / `CharacterBody3D`。不要在同一场景树混用 2D/3D 物理世界。

## 约定

只写实现时必须遵守的约定和易错点。

### 目录 / 命名 / 入口

- 入口是仓库根的 `project.godot` 与其中配置的主场景。不要另起一套启动器盖过现有主场景。
- 按功能分目录，脚本和场景放一起：`player/player.tscn` + `player/player.gd`。不要把所有 `.gd` 丢进扁平 `scripts/`，除非当前仓库已经这样。
- 共享数据用 `resources/`（`.tres` / `.res`），全局服务用 `autoload/`，界面用 `ui/`。项目已有结构则跟仓库，不按本段重铺。
- 文件名 `snake_case`：`player.gd`、`main_menu.tscn`。玩法代码只新增 `.gd` / `.tscn` / `.tres`，不新增 `.cs`。
- 节点名和 `class_name` 用 `PascalCase`：`Player`、`Hitbox`。
- 函数、变量、信号 `snake_case`；信号用已发生的事实：`health_changed`、`died`。私有成员前缀 `_`。
- 路径只用 `res://` 指项目内资源；存档、设置、用户数据只用 `user://`。导出后 `res://` 不可写。

### 类型与脚本

GDScript 在本栈里当**带类型的脚本**用，不当无类型脚本用。强类型靠注解和警告，不靠换成 C#。

- 新代码必须写类型：`var speed: float = 200.0`、`func take_hit(amount: int) -> void`。右边类型明显时用 `:=`。
- 集合尽量写元素类型：`Array[Node]`、`Array[Resource]`。引擎返回 `Variant` 时先显式收成具体类型，再往下传。
- 可复用类型加 `class_name`。不要靠文件路径字符串当类型系统。
- 新项目打开 GDScript 未标注类型相关警告。不要关警告来让未标注代码「通过」。
- 用 Godot 4 注解和语法：`@export`、`@onready`、`await`、`super()`、`instantiate()`、`signal_name.emit()`、`signal_name.connect(...)`。
- 禁止 Godot 3 写法：`export`/`onready` 关键字、`yield`、`instance()`、`connect("sig", self, "_cb")`、`emit_signal("sig")`、`pause_mode`、`KinematicBody*`、`Spatial`、`Tween.interpolate_*`。

### 节点、资源、引用

- 有位置/生命周期/子节点的，用节点；纯数据（数值、掉落表、对话条目）用 `Resource`，不要把数据袋做成空节点。
- 场景内子节点用 `$Child` 或唯一名 `%Name`。禁止 `get_node("../../Foo/Bar")` 这类脆路径。
- 跨场景引用用 `@export` 导出节点类型或 `NodePath`，在 `_ready` 里解析并断言存在。
- `PackedScene.instantiate()` 之后 `add_child`。需要随场景保存的动态子节点才设 `owner`。
- `@onready` 只用于树上已有节点。动态创建的节点不要 `@onready`。
- `queue_free()` 是默认销毁。`await` 之后、信号回调里访问节点前，考虑实例是否还在。

### 过程、物理、输入

- 移动、碰撞、物理查询放 `_physics_process`。纯视觉、UI 动画、非物理计时才用 `_process`。位移乘 `delta`。
- 角色用 `CharacterBody2D/3D` 的 `velocity` + `move_and_slide()`。不要把 Godot 3 的返回值用法搬过来。
- 玩法输入走 `InputMap` 动作名（`Input.is_action_pressed("jump")`），不要在玩法代码里写死键码。
- 玩法读输入优先 `_unhandled_input` / `_unhandled_key_input`，让控件先吃掉 UI 事件。UI 用 `_gui_input`。
- 暂停用 `get_tree().paused` 时，必须给仍要跑的节点设好 `process_mode`（Godot 4，不是 `pause_mode`）。

### 信号与全局

- 节点对外通信优先信号：`signal died` → `died.emit()` → `died.connect(_on_died)`。
- Autoload 只放真正全局的东西（事件总线、存档、音频门面）。不要把关卡状态、玩家属性塞进 Autoload。
- 用 `groups` 做集合查询。不要每帧 `get_tree().root` 扫整棵树。
- 场景树和节点 API 只在主线程调用。后台任务算完把结果送回主线程再改节点。

### 错误、日志、测试

- 异常情况用 `push_error` / `push_warning`；`assert` 只表达开发期不变量。不要用 `print()` 当错误处理。
- 导出路径、节点引用、资源加载失败要在 `_ready` 里尽早暴露，不要拖到第一帧输入才炸。
- 测试跟当前仓库：已有 GdUnit / GUT / 官方测试就用现成的。没有测试框架时，不要擅自加插件；能测的逻辑抽到不依赖场景树的函数里再测。
- 冒烟可用无窗口启动（`--headless`）跑主场景或测试入口。不要把只在编辑器里成立的 `@tool` 行为当成运行时已验证。
- `@tool` 脚本改运行时状态前先判断 `Engine.is_editor_hint()`，避免编辑器里误跑玩法。

### 明确禁止

- 新增 C# / `.cs` / Godot .NET API；不要为了「强类型」或「更工程」改语言。
- 把 Unity 或其他引擎的类型、生命周期、输入、资源加载写法搬进来。
- 在 `_process` / `_physics_process` 里 `load()` 资源、实例化整棵玩法场景、做磁盘 IO。
- 用节点树当存档格式的唯一来源，却把文件写到 `res://`。
- 为了方便 `get_parent().get_parent()` 直取玩家/管理器。
- 在未确认权威的情况下给所有客户端直接改胜负和库存（联机时：生成者权威，`@rpc` 写清方向和权限）。
- 把 UI 做成 `Node2D` 拼坐标，或把玩法碰撞体做成纯 `Control`。
- 为修类型错误而删功能或改回无类型；注解写不上时先改数据模型，再改调用。

## 与项目对齐

本文件是全局默认。仓库若有 `.pi/Stack/godot.md`，以项目文件为准。
仍以当前仓库已有代码为准；主场景名、输入动作名、Autoload 名、插件选择属于 `{项目}/.pi/knowledge/` 或项目 Stack，不要写进本文件。

多角色 AI 怎么分阶段配合，见 `Domain/Godot/AI协作开发.md`。改引擎源码不要套本文件。
