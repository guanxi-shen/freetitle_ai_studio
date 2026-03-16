# Sub-Agent Scope — NOT YET IMPLEMENTED

Phase 6 feature. Backend scope infrastructure exists in context.py (_preamble_shot,
_preamble_scene, _preamble_character). Needs run_sub_agent tool added to tools.py.
See AGENT_DESIGN_IMPLEMENTATION_PHASES.md Phase 6.

When this is built, merge the content below into context-access/SKILL.md.

---

## Sub-Agent Scope

When spawning sub-agents via `run_sub_agent`, pass a `scope` dict to control what starting context the sub-agent receives. The scope uses a single key to determine the type:

```
run_sub_agent(task="...", scope={"shot": [3, 1]})      # scene 3 shot 1
run_sub_agent(task="...", scope={"scene": 3})            # full scene 3
run_sub_agent(task="...", scope={"character": "Kai"})    # character Kai
run_sub_agent(task="...", scope={"custom": {sections}})  # custom context
```

**Scope types and what the sub-agent receives:**

| Scope | Starting Context |
|-------|-----------------|
| `{"scene": N}` | Scene N script details + all shots with covers + video shots overview + scene supplements + scene/shot notes |
| `{"shot": [N, M]}` | Scene N context (condensed) + shot M full script details (dialogue, start_frame, progression) + top 5 frames (ranked) + shot supplements + shot notes |
| `{"character": "Name"}` | Character gallery image details + character notes |
| `{"custom": {sections}}` | Pre-runs `get_project_context` with the sections dict and injects the result |

All scoped sub-agents also receive the common content (script overview, production notes, characters, supplementary counts).

**Custom scope** uses the same `{section: scope_filters}` syntax as `get_project_context`. Use it when the standard scopes don't fit:

```
run_sub_agent(
    task="Generate a character turnaround for Kai in Scene 2 setting",
    scope={"custom": {
        "characters": {"name": "Kai"},
        "script": {"scene": 2},
        "storyboard": {"scene": 2, "shots": [1]}
    }}
)
```
