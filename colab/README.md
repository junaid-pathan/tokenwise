# colab/ — GPU host (owner A)

`sip_colab.ipynb` runs Ollama (Gears 1-4), an `nvidia-smi` power endpoint, and two
cloudflared tunnels on a free T4.

1. Open the notebook in Colab, set Runtime → T4 GPU, then Run all.
2. The last cell prints two `*.trycloudflare.com` URLs. Copy them into the repo `.env`:
   `OLLAMA_URL=<first>`, `POWER_URL=<second>`, and set `POWER_SOURCE=cloud`.
3. Keep the tab open. **Both URLs change on every restart** — re-run and update `.env`.
