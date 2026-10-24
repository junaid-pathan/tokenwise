# Milestones — the joint checkpoints

Each is a check you run **together**, not a design meeting. Timebox it.
Times are from T+0 (start of Phase 1) in the 5-hour plan.

## Hardware gate (~T+1:10, 10 min) — see docs/person-a-aru.md
- [ ] `nvidia-smi` in Colab shows watts
- [ ] 8B uses >= 3x joules per answer vs 0.5B on the same 20 prompts, readings steady
- [ ] Tunnel round trip < 500 ms
- [ ] Power source chosen together; `.env` set by A; `est_wh_per_1k_out_tokens` filled in a joint `contract:` PR
- [ ] B's `heldout.jsonl` + `train.csv` handed to A

## Milestone 1 "first spark" (~T+1:55, 10 min)
- [ ] A prompt gets a classifier gear (`/v1/triage` or a `prompt.received` event)
- [ ] B's replay drives the Grid agent to red (green -> yellow -> red -> green)
- [ ] Both visible on `WS /v1/stream`
- [ ] Mock OFF for grid + triage

## Milestone 2 "first negotiation" (~T+3:35, 15 min)
Turn off `--mock` and run one full replay on real agents.
- [ ] Extension shows a gear and answers from the side panel
- [ ] Replay turns red; Utility requests, Coordinator commits and reports, Utility gives a verdict
- [ ] Sparks turn green, the queue fills then drains, and the wattmeter moves
- [ ] Scorecard shows joules per answer and quality match
- [ ] Narrator lines contain only engine numbers (template lines are fine before B5 lands)
- [ ] Anything failing gets one owner and 15 minutes, otherwise switch to its fallback

## Feature freeze: T+4:30. Then rehearse, backup video, README, submit.

## The 90-second demo
1. **Hook (15 s).** "June 24, 2025: New England nearly ran out of backup power." Press R. Load climbs toward the afternoon peak.
2. **Extension (20 s).** On ChatGPT type "what's 15% of 80". Shifter shows Gear 1, underline "This is a Gear 1 question. Shift down?" Click; side panel answers in under a second.
3. **Negotiation (25 s).** Grid goes red. Utility asks for 25%; Coordinator commits and escalates. Narrator says it in one line. Sparks turn green, jobs queue, the real wattmeter drops.
4. **Proof (20 s).** Scorecard: joules per answer, quality kept, latency, No Downshift vs Downshift.
5. **Close (10 s).** "One laptop GPU here. A 274 MW data center in Westfield is thousands. Same software, and companies plug in with one line."

**Say honestly on stage:** the crowd is simulated; the routing, watts and quality check are real. A median prompt is about 0.24 Wh, so 10,000 users is about 48 kW, one small office building. The megawatts come from data centers and companies running this engine, not from the extension.
