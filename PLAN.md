# PLAN.md — full PRD scope in 5 hours

Nothing is cut from the PRD. All 21 PRs ship: Colab GPU host, real power meter,
trained classifier, extension content script, quality eval, 3D scene, everything.
Phase 0 (contracts, skeleton, hooks) is already done and merged on `main`.

The PRD budgets about 6 h 35 min per person. We have 5 h. That fits only if each
of you runs **2 Kiro agents in parallel**, one per PRD row, each in its own git
worktree (the PRD's own advice):

```powershell
git worktree add ..\ds-a4 -b a/triage-classifier origin/main
```

One agent per folder at a time. Never two agents on the same folder.

## Ordering rule: core first, polish last
The PRD already orders every row Core -> Polish. If time runs short, the LAST
rows slip, and each has a fallback written in the PRD (see "Fallbacks" below).
Core rows are never skipped.

## Timeline (T+0 = start of Phase 1; Phase 0 is done)

| Time | Phase | Person A (Aru) | Person B (Junaid) |
| --- | --- | --- | --- |
| T+0:00–1:55 | 1 Core | A1 colab-host, A2 power-meter, A3 ollama-client, A4 triage (rules first, ~20 min, then classifier), A5 grid-agent | B1 grid-replay, B2 bedrock-client, B3 training-data, B4 utility-agent, B5 narrator |
| ~T+1:10 | Hardware gate + labels hand-off | STOP 10 min with B. Run the 10-minute test, choose the power source together. Take B's labels. | Same. Hand over `heldout.jsonl` + `train.csv`. |
| T+1:55–2:05 | Milestone 1 "first spark" | joint check | joint check |
| T+2:05–3:35 | 2 Core | A6 coordinator-policy, A7 coordinator-negotiation, A8 answer-endpoint, A9 extension-content | B6 crowd-sim, B7 gridroom-scene |
| T+3:35–3:50 | Milestone 2 "first negotiation" | turn off `--mock`, full replay on real agents | same |
| T+3:50–4:30 | 3 Polish | A10 scorecard, A11 gridroom-hud, A12 quality-eval | B8 extension-panel, B9 polish-demo |
| T+4:30–5:00 | 4 Together | rehearse, backup video, README, submit | same |

**Features freeze at T+4:30.**

## Critical path (what blocks whom)
- B3 labels -> A4 classifier training (A trains on 100 hand-labelled prompts until they land).
- B1 replay -> A5 grid agent tuning.
- A2 power meter -> Hardware gate (A's merged PR triggers the STOP rule).
- B2 bedrock client -> A12 quality eval and B5 narrator's real lines.
- Everything else builds against `DOWNSHIFT_MOCK=1` and `contracts/fixtures/`.

## Fallbacks (from the PRD; use only if a row misses its slot)
- No AWS: local Gears 1-3, template Narrator lines, hand-checked quality (n=30).
- No measured power: labelled estimates ("Estimated from published measurements", cited on screen).
- Colab gives no GPU: Kaggle T4, then MX450 local (Gears 1-2), then labelled estimates.
- Extension breaks on a site: use the popup.
- 3D map data fights you: hex-tile Massachusetts map.
- Anything failing at a milestone gets one owner and 15 minutes, then its fallback.

## Hard rules
- Never edit `contracts/`, `engine/app.py`, `engine/bus.py` without a joint `contract:` PR.
- One PRD row = one branch = one PR. Branch from latest `main`. Never base a PR on another feature branch.
- Before opening a PR: `git fetch && git rebase origin/main`, run the row's "Done when" yourself.
- PR title `A4: triage classifier`. Other person reviews within 15 min. Squash merge.
- Commits: lowercase verb + thing, 50 chars max. No AI co-author lines (hook enforces).
- Hardware gate: nobody picks a power source alone. Engine stays on `estimate` until then.
- Anything simulated is labelled "Simulated" in the UI.

## Stretch (only if ahead; claim it in chat so only one of you builds it)
`POST /v1/chat/completions`, OpenAI-compatible, model `downshift-auto`, headers
`X-Downshift-Deferrable` and `X-Downshift-Priority: critical`. Then AWS App Runner deploy.

## Definition of done
Milestone 2 checklist in `docs/milestones.md` fully ticked with mock OFF, plus the
90-second demo rehearsed and a backup video recorded.
