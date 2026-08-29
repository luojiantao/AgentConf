# Context Assembly Extension

User-level Pi extension. It does **not** run on every prompt.

Use `/context <task>` to select role, stack, and project knowledge. The next ordinary prompts then receive that assembled context in the system prompt until you `/context clear` or start a new session.

## Commands

```text
/context <task>   Assemble context for this task. Does not send the task to the model.
/context show     Show the current assembled sources
/context clear    Stop injecting assembled context
```

Reload Pi with `/reload` after changing these files.

## Installed files

```text
~/.pi/agent/
├─ agents/context-builder.md
└─ extensions/context-assembly/
   ├─ index.ts
   ├─ selector.ts
   ├─ sources.ts
   ├─ formatter.ts
   └─ types.ts
```

## Selection boundaries

| Context class | Allowed sources |
| --- | --- |
| Role | `~/.pi/agent/Actor/` only; `README.md` and `_template.md` are ignored |
| Stack | `~/.pi/agent/Stack/`, `<project>/.pi/Stack/`, or allowlisted project technical configuration files |
| Business knowledge | `<project>/.pi/knowledge/`, `<project>/.pi/AGENTS.md`, `<project>/docs/`, and directly relevant root Markdown documents |

## Safety and limits

- The child runs with `PI_OFFLINE=1`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-context-files`, `--no-session`, and only `read`, `grep`, `find`, `ls` tools.
- `PI_CONTEXT_ASSEMBLY_CHILD=1` prevents recursion.
- The parent validates and re-reads candidate paths itself.
- One role, at most four stack sources, and at most six business-knowledge sources are materialized.
- Each source is limited to 32 KiB; the assembled source total is limited to 96 KiB.
- The child has a 60-second deadline.

The context-builder model inherits the parent model by default. Its checked-in `thinking: low` frontmatter in `~/.pi/agent/agents/context-builder.md` keeps selection work within the deadline.
