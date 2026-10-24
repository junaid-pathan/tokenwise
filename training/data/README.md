# training/data/ — owner B (Junaid), PR B3

Collect + label ~2,000 prompts (dolly-15k, gsm8k, mbpp). Deliver by ~hour 1:45:
- `heldout.jsonl` — 200 held-out prompts (crowd sim + quality check use only these)
- `train.csv` — prompt,gear labels (gears 1-5 per the Gears rubric)

Labels: Claude Haiku (20/call) if Bedrock ready, else heuristic (category/length/math-code).
