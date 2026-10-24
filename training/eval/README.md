# training/eval/ — owner A (Aru), PR A12

Quality check: held-out prompts, the router's chosen gear vs Gear 5, judged via
B's Bedrock client. Produces the quality match % for the scorecard.

## Run
```powershell
# needs a live OLLAMA_URL (gears 1-4) + Bedrock creds (gear 5 + judge) in .env
python -m training.eval.quality_eval --n 100   # full check
python -m training.eval.quality_eval --n 10    # quick smoke
```
Writes `training/eval/quality_report.json` with the overall match % and a per-gear
breakdown. Feed that match % into `engine/metrics` (A10) in place of the
placeholder `_DOWNSHIFT_QUALITY_PCT`.

Note: if the Colab tunnel is down, chosen answers fall back to the stub and the
judge will (correctly) rate them worse — re-run once the tunnel is live.
