---
name: ai-plan-doc-writer
description: "Create executor-ready Markdown plans specifically for source-code modifications, including feature implementation, bug fixes, code refactoring, UI or service code changes, test-code changes, and necessary related configuration updates. Plans identify every affected file; every new class or struct with its declaration, responsibility, explanation, and type skeleton; every existing or new function; and framework-level pseudocode for each key function. Invoke only when the user explicitly calls `$ai-plan-doc-writer`; never invoke implicitly for requests to plan, analyze, discuss, document, investigate, design workflows, or produce architecture, configuration-only, documentation-only, operational, or other non-code proposals. The generated plan is intended for `$ai-plan-executor` and includes verified phase roles, scope, constraints, acceptance, validation, risks, and delivery requirements."
---

# AI Plan Doc Writer

## Goal

Create a Markdown source-code modification plan that another AI agent can execute safely and mechanically. The document must explain what code to change, why the change is needed, where to modify it, how to implement it, which phase-specific role the executor should use, what is out of scope, how to decide it is done, how to perform mandatory static validation, and which risks remain.

Apply the six-element prompt boundary. Resolve the guide in this order and use the first file that exists:

1. `{project}/Doc/AIPrompt/AI提示词六要素设计指南.md`
2. `C:\Users\41290\.pi\agent\Domain\AIUse\AI提示词六要素设计指南.md`

```text
Role + TechStack + Domain + Requirement + Constraints + Acceptance
```

Treat `Role` only as identity, responsibilities, decision perspective, working style, and responsibility boundary. Do not embed technology, domain knowledge, task requirements, constraints, or acceptance criteria into role definitions.

Map the six elements onto plan sections. Do not dump all six into one section:

| Element | Plan section |
| --- | --- |
| Role | `阶段角色与职责` and the current-role line at the start of each implementation phase |
| TechStack | engineering rules inside `执行约束`; never inside a role |
| Domain | objects, states, and invariants in `背景与现状` |
| Requirement | `目标` + `需求范围` |
| Constraints | `非目标` + `执行约束` |
| Acceptance | `验收标准` + `代码静态校验` + `运行验证方式` |

Optimize the plan for a two-skill workflow:

```text
ai-plan-doc-writer -> executor-ready plan MD -> ai-plan-executor
```

This skill writes the plan only. It must not execute the plan or mix implementation work into the planning document.

## Canonical Template

The required output is a filled copy of this skill's template:

- Skill copy (authoritative): `C:\Users\41290\.pi\agent\skills\ai-plan-doc-writer\源码修改执行方案模板.md`
- Domain copy (keep in sync): `C:\Users\41290\.pi\agent\Domain\AIUse\源码修改执行方案模板.md`

Rules:

- Read the template before writing the plan.
- Copy its section order and headings exactly.
- Do not replace it with a thesis/IMRaD outline, architecture essay, or a newly invented TOC.
- Do not copy the template preamble (`适用 / 不适用`, `填写规则`) into the generated plan. Start from the plan title.
- The filled plan must let an executor answer four questions: which files, which functions, what not to touch, how to know it is done.
- Empty `修改范围` or `函数级修改设计` means the plan is not executor-ready. Inspect current code first.
- Do not embed final production code. Use framework-level pseudocode only.
- Small changes may shorten prose, but must not drop: `目标`, `需求范围`, `非目标`, `执行约束`, `修改范围`, `函数级修改设计`, `验收标准`, `代码静态校验`, `运行验证方式`.
- If there is no new type, keep `新增类与结构体设计` and write `无新增类或结构体`.

## Invocation and Scope Boundary

- Run this skill only after the user explicitly invokes `$ai-plan-doc-writer`.
- Never trigger this skill implicitly from a general request to create a plan, analyze a problem, discuss an approach, or write documentation.
- Use this skill only when the requested deliverable is an implementation plan whose execution will modify source code.
- Related configuration, tests, and documentation may be included only when they are necessary parts of the source-code modification.
- Do not use this skill for architecture-only proposals, configuration-only plans, documentation-only plans, investigation-only plans, operational procedures, workflow designs, test plans without code changes, or other non-code proposals.
- If the user explicitly invokes this skill for a task that does not require source-code modification, stop and explain that the task is outside this skill's scope rather than generating the plan with this skill.

## Workflow

1. Confirm that the user explicitly invoked `$ai-plan-doc-writer` and that the implementation target requires source-code modification: feature implementation, bug fix, code refactor, UI or service code change, test-code change, or a code change with necessary related configuration updates. Stop if either condition is not met.
2. Read the resolved six-element guide and preserve the boundary between Role, TechStack, Domain, Requirement, Constraints, and Acceptance.
3. Resolve the role catalog, first match wins:
   - `{project}/Doc/AIPrompt/AIActor/README.md`
   - `C:\Users\41290\.pi\agent\Actor\README.md`
   Inspect the complete document for every candidate role before selecting it. This resolved catalog is the only source of Role indices.
4. Read `源码修改执行方案模板.md` in this skill directory. The generated plan must use that template's headings, tables, and section order.
5. Map every execution phase to one or more existing role indices from the resolved catalog. Start from the template's default table (`developer` + `code-requirement-verifier`) only after verifying those indices exist. If any required phase has no suitable role, or a default index is missing, stop before creating or modifying the plan document and ask the user whether to add a role or designate an existing role. Never invent, approximate, or silently substitute a role.
6. Read relevant local code, configuration, documentation, or existing plans before writing the final plan. If exact files are unknown, inspect enough to name likely modules and discovery steps.
7. Classify the plan type, risk level, allowed operation types, affected scope, restart needs, and recommended executor skill.
8. Separate required scope, non-goals, and hard execution constraints.
9. Describe the implementation path in terms of data flow, state flow, API calls, service interactions, configuration changes, UI behavior, persistence changes, or documentation changes as applicable.
10. List every expected source file with structured columns that an executor can parse: change type, required/optional, purpose, affected type, and affected functions.
11. Add a new-type design that lists every class or struct to add, explains why it is needed, and provides its namespace, declaration, responsibility, dependencies, state, public surface, lifecycle, and framework-level type skeleton.
12. Add a function-level change design that distinguishes existing functions to modify from new functions to add. For every key function, provide framework-level pseudocode describing validation, branches, calls, state changes, error handling, and return behavior without writing the final implementation.
13. Assign the selected role indices locally to execution phases. Roles are phase-scoped instructions, not global conversation identities.
14. Split implementation steps into phases: code reading, pre-change confirmation, implementation, self-check, runtime validation, static validation, and final delivery.
15. Write acceptance criteria as true/false checks.
16. Always include a `代码静态校验` section with the fixed validation method below.
17. Write `运行验证方式` from the actual task context. Do not use generic commands that do not fit the repo or the change.
18. End with risks, assumptions, final delivery requirements, and an execution entry prompt for `$ai-plan-executor`.
19. Deliver a filled template, not a thesis. Before finishing, confirm the four executor questions are answered and that no IMRaD / literature-review / academic-contribution sections were added.

## Required Structure

Copy `源码修改执行方案模板.md` and fill it. Do not invent another outline. Keep `方案元信息`, `执行约束`, `阶段角色与职责`, `代码静态校验`, `运行验证方式`, `最终交付要求`, and `执行入口提示` unless the user explicitly asks for a non-executable draft.

```md
# 方案标题

## 方案元信息

## 目标

## 背景与现状

## 需求范围

## 非目标

## 执行约束

## 阶段角色与职责

## 实现方案

## 修改范围

## 新增类与结构体设计

## 函数级修改设计

## 实现步骤

## 验收标准

## 代码静态校验

## 运行验证方式

## 风险与假设

## 最终交付要求

## 执行入口提示
```

## Section Rules

### 方案元信息

Place this section near the top so an executor can choose the right strategy quickly.

Use a table:

```md
| 项目 | 内容 |
| --- | --- |
| 方案类型 | 功能代码开发 / 缺陷修复 / 代码重构 / UI 代码调整 / 服务代码改动 / 测试代码改动 |
| 风险等级 | 低 / 中 / 高 |
| 主要影响范围 | `path/or/module` |
| 是否允许改代码 | 是 / 否 |
| 是否允许改配置 | 是 / 否 |
| 是否允许新增测试 | 是 / 否 |
| 是否需要重启服务 | 是 / 否 / 待确认 |
| 推荐执行 skill | `ai-plan-executor` |
| 角色策略 | 仅使用已解析角色目录中的 Role 索引，按 `阶段角色与职责` 逐阶段切换 |
```

Choose values from the task context. Use `待确认` only when code inspection cannot determine the answer.

### 目标

State the final observable result. Avoid vague verbs such as "优化", "完善", or "支持" unless followed by specific behavior.

### 背景与现状

Explain current behavior, existing capability, current limitation, and why this change is needed. Reference known classes, modules, config files, commands, pages, services, or workflows.

### 需求范围

List only what must be implemented. Each bullet should be actionable.

### 非目标

List what must not be changed. Use this section to prevent broad refactors, unrelated UI redesigns, permission changes, data migrations, protocol changes, or behavior changes outside the request.

### 执行约束

Write hard rules for the executor. Include rules like:

```md
- 必须严格按本文档范围执行。
- 不允许进行方案外重构、统一格式化或无关清理。
- 不允许修改未列入修改范围的业务逻辑，除非实现步骤明确要求。
- 如果发现方案与现有代码冲突，必须先停止并说明冲突，不得自行扩大范围。
- 如果实际代码结构与方案预估文件不一致，必须先补充实际文件清单，再继续实现。
- 涉及配置、设备动作、数据库或调度逻辑时，必须保留回滚和人工验证说明。
- 技术与工程规范以当前仓库及对应 Stack 文档为准，不在角色定义里重复。
```

Adapt these rules to the plan. Do not make constraints so broad that execution becomes impossible.

### 阶段角色与职责

Write this section when the plan has more than one execution phase, or when different perspectives are useful in the same conversation. Roles must be explicit, practical, and scoped to the phase where they apply.

Use the following role-selection protocol before writing this section:

1. Treat the resolved role catalog as the single source of truth for available roles: `{project}/Doc/AIPrompt/AIActor/README.md` if present, otherwise `C:\Users\41290\.pi\agent\Actor\README.md`.
2. Use the catalog's exact Role index, such as `architect`, `developer`, `code-requirement-verifier`, or a project index like `bionanosemi-dev`. Do not replace it with a newly coined display name.
3. Read the complete Markdown file linked by each candidate index and verify that its identity, responsibilities, decision perspective, working style, and boundaries fit the phase.
4. Reuse one Role index across multiple phases when its documented responsibilities cover them. Do not create extra roles merely to make every phase name different.
5. Start from the template default table below. If `developer` or `code-requirement-verifier` is missing from the resolved catalog, stop and ask; do not silently substitute another role.
6. If no indexed role satisfies a required phase, stop and ask the user. Do not write the plan, use an unlisted fallback, or expand an existing role's responsibilities.
7. If the user requests an unlisted role, stop and ask whether the user wants to add it to the resolved catalog or choose an existing index.

Use this default table from the template. Verify every index against the resolved catalog, then adjust responsibilities to the selected role documents:

```md
| 阶段 | Role 索引 | 本阶段职责 | 输出重点 | 切换条件 |
| --- | --- | --- | --- | --- |
| 代码阅读阶段 | `developer` | 核对真实文件、调用链、冲突点 | 文件清单、调用链 | 关键代码和配置已定位 |
| 修改前确认阶段 | `developer` | 核对范围、非目标、约束仍成立 | 冲突与待确认项 | 无未决冲突，或已请示用户 |
| 实现阶段 | `developer` | 按修改范围做最小改动 | 代码变更 | 代码改动完成 |
| 自检阶段 | `developer` | 对照验收标准和执行约束 | 自检表 | 自检完成 |
| 运行验证阶段 | `developer` | 执行本文指定的命令或操作 | 验证记录 | 能跑的项已跑完 |
| 静态校验阶段 | `code-requirement-verifier` | 用代码证据核对需求完成度，不改代码 | 校验报告 | 结论明确 |
| 最终交付阶段 | `developer` | 按最终交付要求汇总 | 交付清单 | 文档齐全 |
```

If a phase needs structure, UI path, or play-experience judgment, switch that row to an existing index such as `architect` / `interface` / `playtester` and rewrite that row's responsibility. Never leave placeholders in the final plan.

Rules:

- Do not put a single global role at the top and rely on it for the whole plan.
- The executor must switch role only at the start of the matching phase.
- Each role must state what it should pay attention to and what it must output.
- Role instructions must not override `需求范围`, `非目标`, `执行约束`, safety requirements, or user instructions.
- The Role index is the identifier recorded in the plan. Human-readable identity may be mentioned in the responsibility text, but it must not replace the index.
- Role responsibility text must come from the selected Role document and remain within the Role boundary defined by the six-element guide.
- Do not use a default or fallback role unless its index exists in the role catalog and its document actually covers the phase.

### 实现方案

Describe the core implementation approach. Include relevant flows:

- Frontend/UI: user action, view model/state update, command binding, loading/error/success state, display refresh.
- Backend/service: request entry, validation, business logic, persistence, error handling, response shape.
- Distributed equipment control: caller, service/module, command path, DataSync topic, job state, IO/config dependency, restart behavior.
- Configuration: file path, key names, default values, compatibility, reload or restart behavior.
- Database/storage: schema/field mapping, migration or compatibility strategy, rollback.

Use Mermaid only when branching, cross-service calls, or state transitions would otherwise be ambiguous.

### 修改范围

Use a structured table:

```md
| 文件或模块 | 修改类型 | 是否必须 | 涉及类/类型 | 涉及函数 | 修改目的 |
| --- | --- | --- | --- | --- | --- |
| `path/to/file` | 修改 / 新增 / 删除 / 待确认 | 必须 / 可选 | `TypeName` | `ExistingMethod`、`NewMethod`（新增） | 说明为什么要改 |
```

List source files as precisely as current code inspection allows. Every source file must name the affected class/type and functions. If a file changes only project metadata, imports, type declarations, fields, properties, XAML, generated code, or configuration and has no affected function, write `不涉及函数` and explain the changed symbol or section. If exact paths are not yet known, write module-level paths and add an implementation step requiring the executor to locate exact files before editing.

### 新增类与结构体设计

Write this section for every plan. If no class or struct will be added, write `无新增类或结构体` explicitly. Otherwise, list every new type before describing its skeleton:

```md
| 文件 | 命名空间 | 类型名称 | 类型种类 | 可见性 | 基类/接口 | 核心职责 | 新增原因 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `path/to/NewType.cs` | `Project.Namespace` | `NewType` | class / struct | public / internal | `BaseType`、`IContract` / 无 | 单一职责 | 为什么不能复用现有类型 |
```

For every new class or struct:

- Explain its responsibility boundary, callers/consumers, dependencies, owned state, thread-safety or lifecycle requirements when relevant, and why a new type is preferable to extending an existing type.
- Give the proposed declaration, including namespace, accessibility, `class` or `struct`, base class, implemented interfaces, and important modifiers such as `sealed`, `abstract`, or `readonly`.
- List important fields, properties, constructor dependencies, public methods, and private helpers. Every callable member must also appear in `函数级修改设计`.
- Provide a non-compilable framework-level type skeleton. Show structure and relationships only; do not write production method bodies or invent unverified repository APIs.
- Map every new type to a file in `修改范围`. Do not list a new file without explaining the type it contains.

Use this format:

````md
#### `path/to/NewType.cs` — `Namespace.NewType`

- 类型：class / struct
- 职责：说明单一职责和边界
- 使用方：说明谁创建、持有或调用它
- 生命周期：singleton / scoped / transient / value object / 手工管理
- 新增原因：解释为什么需要新类型

```text
type NewType : BaseType, IContract
    dependencies:
        verified dependency contracts
    state:
        fields and properties with ownership notes
    construction:
        constructor inputs and invariants
    public surface:
        methods and their responsibilities
    private helpers:
        helper names and boundaries
```
````

### 函数级修改设计

Write this section for every plan. Use a structured table first:

```md
| 文件 | 类/类型 | 函数或成员 | 变更类型 | 建议签名 | 职责 | 调用关系 |
| --- | --- | --- | --- | --- | --- | --- |
| `path/to/file` | `TypeName` | `ExistingMethod` | 修改现有函数 | `ReturnType ExistingMethod(Args)` | 修改后的职责 | 由谁调用、调用谁 |
| `path/to/file` | `TypeName` | `NewMethod` | 新增函数 | `ReturnType NewMethod(Args)` | 新函数职责 | 由谁调用、调用谁 |
```

Rules:

- List every existing function whose body, signature, visibility, attributes, or call contract will change.
- List every function, constructor, event handler, command handler, test method, or other callable member that will be added.
- Use the real current signature for existing functions. For new functions, propose a signature consistent with the current code style and label unresolved details explicitly.
- Distinguish overloaded functions by complete signature. Name the containing class/type for every function.
- Map every function entry back to a file in `修改范围`; do not leave orphan function designs.
- After the table, give framework-level pseudocode for each key modified or new function. Pseudocode must show control flow, validation, important branches, calls, state mutations, exception/error handling, and return behavior when applicable.
- Keep pseudocode language-neutral or C#-like and non-compilable. Do not write the final production implementation, omit established boilerplate, or invent repository APIs that have not been verified.
- Small trivial accessors may be grouped when their behavior is identical, but their names must still appear in the table.

Use this per-function format:

````md
#### `path/to/file` — `TypeName.MethodName`

- 变更类型：修改现有函数 / 新增函数
- 目标：说明函数修改后的单一职责

```text
function MethodName(arguments):
    validate required inputs
    if guard condition fails:
        record or return the defined failure result
    call verified dependency
    update required state
    return result
```
````

### Complete Example

This compact example demonstrates the required format only. Its paths and symbols are illustrative, not repository facts.

````md
## 修改范围
| 文件 | 类型/成员 | 变更 | 说明 |
| --- | --- | --- | --- |
| `ProcessJobStateHandler.cs` | `ProcessJobStateHandler.HandleAsync` | 修改函数 | 在状态推进前调用幂等组件 |
| `ProcessJobMessageDeduplicator.cs` | `ProcessJobMessageDeduplicator` | 新增类 | 封装消息处理权声明 |
| `ProcessJobMessageKey.cs` | `ProcessJobMessageKey` | 新增结构体 | 表达不可变幂等键 |

## 新增类与结构体设计
- `internal sealed class ProcessJobMessageDeduplicator`：持有已验证的幂等存储依赖；由处理器调用；新增原因是隔离存储细节。
- `internal readonly struct ProcessJobMessageKey`：持有 PJ 与消息标识；不持有服务或可变状态；新增原因是约束幂等键。
```text
class ProcessJobMessageDeduplicator:
    dependency: verified idempotency store
    public: TryAcquireAsync(ProcessJobMessageKey key)
readonly struct ProcessJobMessageKey:
    immutable state: processJobId, messageId
    construction: validate and assign identifiers
```

## 函数级修改设计
| 函数 | 变更 | 职责 |
| --- | --- | --- |
| `ProcessJobStateHandler.HandleAsync` | 修改 | 校验、查重后沿原路径推进状态 |
| `ProcessJobMessageDeduplicator.TryAcquireAsync` | 新增 | 原子声明消息处理权 |
```text
HandleAsync(message):
    validate identifiers
    if await deduplicator.TryAcquireAsync(key) is false: log and return
    call existing state advancement path
```
````

### 实现步骤

Group steps by phase:

```md
### 1. 代码阅读阶段

当前 Role：`developer`

- 阅读 `修改范围` 中的文件和调用方。
- 确认真实签名、错误处理、配置键与方案是否一致。
- 输出：实际文件清单、冲突点。

### 2. 修改前确认阶段

当前 Role：`developer`

- 对照 `需求范围`、`非目标`、`执行约束`。
- 有冲突先停并说明，不开始改代码。

### 3. 实现阶段

当前 Role：`developer`

- 只改列入范围的文件和函数。
- 按函数级伪代码落地，风格跟随周围代码。
- 不新增方案外抽象。

### 4. 自检阶段

当前 Role：`developer`

- 逐条勾 `验收标准`。
- 检查是否出现方案外重构、格式化或无关文件。

### 5. 运行验证阶段

当前 Role：`developer`

- 只执行 `运行验证方式` 中的命令或操作。
- 记录命令、结果、失败原因；环境不可用时写明缺什么。

### 6. 静态校验阶段

当前 Role：`code-requirement-verifier`

- 按 `代码静态校验` 出报告。
- 本阶段不修改代码。

### 7. 最终交付阶段

当前 Role：`developer`

- 按 `最终交付要求` 汇总。
- 写清与方案骨架的偏差和剩余风险。
```

Verify these default Role indices against the resolved catalog before delivering the plan. Keep each step executable. Start by reading current code and confirming contracts. End by comparing acceptance criteria and producing the validation report. The role line is a local execution frame for that phase; it must not leak into later phases after the plan switches roles.

### 验收标准

Write true/false bullets. Each item should be possible to mark as `已满足` / `未满足` / `部分满足`.

## Static Validation Section

Always write `代码静态校验` as a fixed section. It must require the main execution agent to perform static code validation, even when runtime validation is also available.

Use this baseline and adapt only task-specific check items:

```md
## 代码静态校验

主执行 agent 必须在实现后执行代码静态校验，并在最终交付中输出静态校验报告。这里的主执行 agent 指当前执行本方案的 Codex 或 Claude Code 会话。

静态校验执行方式：

1. 逐条对照本方案的方案元信息、需求范围、非目标、执行约束、实现步骤和验收标准，说明每一项是否已实现或遵守。
2. 标出每一项对应的代码位置，至少精确到文件；关键逻辑应精确到类、方法或配置键。
3. 沿真实调用链检查数据流、状态流、接口调用、配置读取、错误处理和返回结果。
4. 检查字段名、参数名、配置键、事件名、DataSync topic、返回结构是否前后一致。
5. 检查是否遗漏错误处理、空状态、权限、重复提交、并发、回滚、重启要求或兼容性处理。
6. 检查是否存在明显逻辑错误，例如条件写反、默认值错误、状态未更新、异常被吞掉、资源未释放。
7. 检查是否引入方案之外的重构、格式化、无关文件修改或行为变化。
8. 列出无法通过静态阅读确认、必须实际运行或联机验证才能确认的风险。
9. 给出最终结论：可以进入下一步 / 需要修改 / 必须运行验证后再判断。

当无法完整运行环境，且本次改动属于高风险或跨模块改动时，如果当前工具支持独立子 agent、Task 或 reviewer agent，建议额外启动独立复核 agent 做二次静态复核。独立复核 agent 只负责复核，不参与实现；主执行 agent 必须汇总复核发现并对最终结论负责。

静态校验报告模板：

| 检查项 | 结论 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| 方案要求 1 | 已实现 / 未实现 / 部分实现 | `path/to/file` | 说明 |

无法静态确认的风险：

- 风险 1：
- 风险 2：

最终结论：

结论：可以进入下一步 / 需要修改 / 必须运行验证后再判断。

理由：
```

## Runtime Validation Section

Write `运行验证方式` from the actual task context. Include only relevant verification paths.

Choose from these patterns:

- Pure logic or library change: build the affected project, run unit tests, add focused tests when reasonable.
- WPF/UI change: build affected GUI/module project, run the screen manually if possible, verify bindings, commands, visual states, permissions, and error prompts.
- Service change: build affected service, run focused service or integration test, verify logs, configuration, startup, and key request/command path.
- Equipment/PLC/robot/IO change: state simulator, fixture, dry-run, manual regression, interlock, restart, and operator verification requirements. Do not pretend full hardware validation is available.
- Configuration change: validate JSON/XML syntax, key names, service restart requirement, compatibility with default values, and manual startup check.
- Database/storage change: validate schema/field mapping, migration/rollback path, read/write compatibility, and data retention risk.

If the runtime environment is unavailable, still write future validation steps and explicitly say which checks must wait for a runnable environment.

## Final Delivery Requirements

Require the execution agent to output:

1. Modified file list.
2. Actual new class and struct list, including final declarations, responsibilities, and deviations from the planned type skeletons.
3. Actual modified and newly added function list for each file, including final signatures.
4. Change summary for each file, type, and function, including deviations from the planned pseudocode framework.
5. Completion status against every acceptance criterion.
6. Execution-constraint compliance status.
7. Phase-role execution summary using the exact Role indices from the resolved catalog, including any phase where the documented role could not be applied.
8. Tests or validation commands run, including failures.
9. Reason if runtime validation could not be run.
10. Static validation report.
11. Remaining risks and manual checks.

## Execution Entry Prompt

End each executor-ready plan with an `执行入口提示` section:

```md
## 执行入口提示

请使用 `$ai-plan-executor` 执行本文档。

执行要求：

1. 先完整阅读本文档。
2. 提取目标、方案元信息、需求范围、非目标、执行约束、修改范围、新增类与结构体设计、函数级修改设计和验收标准。
3. 提取 `阶段角色与职责` 中的 Role 索引，确认索引存在于已解析角色目录，并在每个阶段开始时切换到该角色。
4. 实现前检查方案与现有代码是否冲突。
5. 严格按方案修改，不做方案外重构。
6. 如果发现实际文件结构与方案不一致，先补充实际文件清单再继续。
7. 实现后必须执行代码静态校验。
8. 根据 `运行验证方式` 执行可运行的验证项。
9. 最终按 `最终交付要求` 输出结果，并说明阶段角色执行情况。
```

## Final Check

Before finishing the plan document, verify:

- The first screen explains what the plan is for and which executor should run it.
- An executor can answer: which files, which functions, what not to touch, and how to know it is done.
- Plan metadata is filled with concrete values or justified `待确认` values.
- Scope, non-goals, and execution constraints prevent unnecessary changes.
- Phase roles are written as local phase instructions and do not conflict with execution constraints.
- The plan is a filled copy of `源码修改执行方案模板.md`, not a thesis or a newly invented outline.
- Every phase role uses an exact index from the resolved role catalog, and each selected role document has been checked for suitability.
- If no suitable indexed role exists, plan writing has stopped and the user has been asked instead of receiving an invented role.
- Modification scope is structured and executor-readable.
- Every new class or struct has a file, namespace, declaration, responsibility, dependency/state explanation, lifecycle, reason for addition, and framework-level type skeleton; plans with no new type say so explicitly.
- Every callable member shown in a new type skeleton also appears in `函数级修改设计`.
- Every affected source file identifies the existing functions to modify and new functions to add; non-function changes are explicitly explained.
- Every key modified or new function includes framework-level pseudocode covering its main control flow without embedding the final implementation.
- Every function-level design maps to a file in `修改范围`, and the illustrative example has not been copied as repository fact.
- Implementation steps are phased, ordered, and executable.
- Acceptance criteria are true/false checks.
- Static validation is mandatory and includes report format.
- Runtime validation is task-specific, not generic filler.
- Risks distinguish assumptions, static-only uncertainty, and runtime-only uncertainty.
- The execution entry prompt explicitly references `$ai-plan-executor`.
- The document does not contain TODO placeholders unless the executor is explicitly instructed to resolve them before editing.
