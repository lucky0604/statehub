# AI PM

The Writable AI PM is StateHub's planning + advisory layer. It reads the
workspace state, produces a structured answer, and proposes action cards
that the user can apply, edit, or dismiss. The AI PM **never** writes
project state directly — every mutation goes through the action-card
lifecycle so the user stays in control.

Source: `agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md`

## Modes

The AI PM operates in 5 modes. Each mode produces a different kind of
answer + action card mix:

| Mode | Purpose | Typical action cards |
| --- | --- | --- |
| `advisor` | Read-only state summary + risks + next action | `set_current_focus`, `record_decision` |
| `plan` | Propose features/work items/acceptance criteria | `create_feature`, `create_work_item` |
| `review_triage` | Must-fix vs can-defer for a feature's open findings | `create_review_fix_items`, `dismiss_high_finding` |
| `weekly_review` | Completed / stalled / risks / next-week focus | `save_weekly_review`, `change_portfolio_priority` |
| `prompt_builder` | Generate OpenCode/Codex/fix/release prompts | `generate_agent_prompt` |

## Action types

13 action types, split into 8 normal + 5 high-risk:

**Normal** (no confirmation required):
- `create_feature`
- `create_work_item`
- `update_work_item_priority`
- `set_current_focus`
- `record_decision`
- `create_review_fix_items`
- `save_weekly_review`
- `generate_agent_prompt`

**High-risk** (require `confirm_high_risk=true` on apply):
- `pause_project`
- `archive_project`
- `dismiss_high_finding`
- `mark_feature_done` — also runs the Done Gate; blocked if the gate blocks
- `change_portfolio_priority`

High-risk dismissals require a `reason` string.

## Action card lifecycle

```
pending  ──apply──→  applied
   │
   └──dismiss──→  dismissed
```

- **pending** — the AI PM proposed it; the user hasn't acted yet.
- **applied** — the user applied it; the underlying domain write executed.
- **dismissed** — the user rejected it (with a reason for high-risk).

Cards are immutable once applied/dismissed. The `edit` operation only works
on pending cards and increments `edit_count`.

## Safety rules

1. **The AI PM never writes state.** It only proposes cards; the user
   applies them. (phase-05 §8 rule 1)
2. **High-risk actions require explicit confirmation.** The API returns
   `422 high_risk_confirmation_required` if `confirm_high_risk` is missing.
3. **`mark_feature_done` runs the Done Gate.** If the gate blocks, the API
   returns `422 done_gate_blocked` with the blocking checklist items.
4. **Apply always re-validates.** Even if the card was created seconds ago,
   the apply path re-checks referential integrity against the current DB
   state. A card referencing a deleted project returns `404 not_found`.
5. **Already-applied/dismissed cards cannot be re-applied.** Returns
   `409 conflict`.

## API

All routes are under `/api/workspaces/:wid/`:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/ai-pm/query` | Run the AI PM; returns answer + action cards |
| POST | `/ai-pm/actions/:id/apply` | Apply a pending card |
| POST | `/ai-pm/actions/:id/dismiss` | Dismiss a pending card |
| POST | `/weekly-reviews` | Save a weekly review |
| GET | `/weekly-reviews` | List weekly reviews (optional `?project_id=`) |
| POST | `/decisions` | Record a decision |

All routes return the canonical `{ ok, data | error }` envelope.

## UI

The AI PM Dock lives at `/workspaces/:wid/ai-pm` and is linked from the
sidebar (sparkle icon, between Reviews and Agent Runs).

The dock has 5 mode tabs. Selecting a mode + project + feature and clicking
"Run" calls `POST /ai-pm/query` and renders:
- The **answer block** (conclusion, basis, risks, missing-data warnings)
- The **action card list** (grouped by pending/applied/dismissed)

Each action card has **Apply** / **Edit** / **Dismiss** buttons. High-risk
cards open a confirmation modal with an "I confirm" checkbox before Apply
is enabled.

## Event log

Every action-card operation emits an event:

| Event | When |
| --- | --- |
| `ai_pm.query` | An AI PM query runs |
| `ai_pm.action_card_created` | A card is persisted from a query |
| `ai_pm.action_applied` | A card is applied |
| `ai_pm.action_dismissed` | A card is dismissed |
| `ai_pm.action_edited` | A card's payload is edited |
| `weekly_review.saved` | A weekly review is saved |

Events are visible in the recent events feed and the event log table.
