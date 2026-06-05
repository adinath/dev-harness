# Plans

Outputs from the pipeline land here. Three kinds of files appear:

| File pattern | Author | Stage |
| --- | --- | --- |
| `<feature>-plan.md` | `spec-reader` | After reading the spec |
| `<feature>-arch-review.md` | `architect-review` | After reviewing the plan |
| `<feature>-review.md` | `code-reviewer` | After reviewing implementation |

Files in this directory are append-only historical artifacts of each feature's pipeline run. Do not delete or edit them after the pipeline completes; they form the audit trail.
