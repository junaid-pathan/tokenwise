# Milestones — the two joint checkpoints

Each milestone is a check you run **together**, not a design meeting. Timebox it.
In the 4-hour cut these land earlier than the PRD's 8-hour schedule.

## Milestone 1 — "first spark" (~hour 1:30, 10 min)
Run both your pieces against each other for the first time. Mock OFF for grid,
crowd can still be fixture prompts.

- [ ] Start the engine: `uvicorn engine.app:app --port 8000` (no `DOWNSHIFT_MOCK`).
- [ ] Junaid: `POST /v1/demo/replay {"date":"2025-06-24","speed":480}`.
- [ ] Aru's Grid agent turns the replay load into `grid.state` green → yellow → red.
- [ ] Send one prompt (curl `/v1/triage` or a fixture `prompt.received`) → it gets a gear.
- [ ] Both events are visible on `WS /v1/stream`.

If anything fails: one owner, 15 minutes, else fall back (hard-coded curve for
replay; rules for triage). Then move on.

## Milestone 2 — "first negotiation" (~hour 3:00, 15 min)
Turn off every mock and run one full replay on the real agents.

- [ ] Replay turns red; Utility requests; Coordinator commits and reports; Utility gives a verdict.
- [ ] Crowd sim prompts flow; Coordinator shifts gears down under red.
- [ ] Grid Room: floor tints red, sparks turn green when downshifted, wattmeter moves.
- [ ] Scorecard shows joules/answer and quality match (quality may be a placeholder in 4h).
- [ ] Narrator lines contain only engine numbers (template lines are fine).
- [ ] Anything failing gets one owner and 15 minutes, otherwise switch to its fallback.

## The 90-second demo (rehearse in the last 10 min)
1. Hook (15s): "June 24, 2025: New England nearly ran out of backup power." Press replay; load climbs.
2. Extension/panel (20s): type a Gear 1 question; the panel answers in under a second.
3. Negotiation (25s): grid red; Utility asks for 25%; Coordinator commits; Narrator says it; sparks go green; wattmeter drops.
4. Proof (20s): scorecard — joules/answer, quality kept, latency, No Downshift vs Downshift.
5. Close (10s): "One laptop here. A data center is thousands. Same software, one line to plug in."

Say honestly on stage: the crowd is simulated; the routing and the scorecard math
are real; power is estimated from published measurements (we skipped the live
meter in the 4-hour build).
