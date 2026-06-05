---
description: Start implementing a feature from its spec file. Kicks off the full agent pipeline (spec-reader -> architect-review -> implementer -> test-writer -> code-reviewer). Usage: /implement <spec-name>
argument-hint: <spec-name>
---

Start implementing the feature defined in `harness/specs/$ARGUMENTS.md`.

1. Confirm the spec file exists by reading it. If it does not exist, list the available specs in `harness/specs/` and ask which one to use.
2. Initialize the agent queue by writing to `harness/queue/agent-queue.json`:

```json
{
  "currentSpec": "$ARGUMENTS",
  "currentStage": "spec-reader",
  "status": "STARTING",
  "startedAt": "<current ISO timestamp>",
  "implementedFiles": [],
  "testFiles": []
}
```

3. Invoke the `spec-reader` subagent with the spec name `$ARGUMENTS`.

After `spec-reader` completes, the queue-advance hook will tell you the next stage and the next subagent to invoke. Follow that prompt until the queue reaches `COMPLETE`, `BLOCKED`, or a `NEEDS_*` status that requires user input.
