# LILA BLACK — Player Journey Visualizer

A web tool that turns LILA BLACK's raw parquet telemetry into a Level-Designer-friendly map view: per-match player paths, kill/death/loot markers, heatmaps, and timeline playback.

**Live demo:** _add your deployment URL here after deploying_

---

## Tech stack

- **Preprocessor:** Python 3 + pyarrow (one-time ETL parquet → JSON)
- **Frontend:** vanilla HTML/CSS/JS + 4-layer HTML `<canvas>` — no build step
- **Hosting:** any static CDN (Vercel / Netlify / GitHub Pages)

No env vars needed. No backend.

---

## Setup

```bash
# 1. (one-time) install Python deps to regenerate data
pip install pyarrow pandas

# 2. preprocess the raw parquet into data/  (already committed; only rerun if data changes)
python scripts/preprocess.py --src /path/to/player_data --out ./data

# 3. serve the static site
python -m http.server 8000
# open http://localhost:8000
```

`data/` and `minimaps/` are committed so the site works out of the box. Step 2 is only needed if the source parquet changes.

---

## Project layout

```
lila-journey-viz/
├── index.html              main page
├── style.css               styles
├── app.js                  rendering + UI logic
├── data/                   preprocessor output (committed)
│   ├── index.json          match catalog
│   ├── summary.json        global stats
│   ├── matches/{mid}.json  one file per match (lazy-loaded)
│   └── aggregate/{map}.json   cross-match bundles
├── minimaps/               3 minimap images (1024×1024)
├── scripts/
│   └── preprocess.py       parquet → JSON
├── README.md               this file
├── ARCHITECTURE.md         one-page architecture
└── INSIGHTS.md             three insights
```

---

## Deploy

The whole site is static. Any of these works:

- **Vercel:** New Project → import the GitHub repo → preset "Other" → blank build/output → Deploy.
- **Netlify:** Add new site → import from Git → blank build command → publish dir `.`.
- **GitHub Pages:** Settings → Pages → branch `main`, folder `/ (root)`.

No env vars. After deploy, paste the URL into the "Live demo" line above and commit.

---

## Features

- Player paths on the correct minimap (humans solid blue, bots dashed yellow)
- Distinct markers for **Kill / Killed / BotKill / BotKilled / KilledByStorm / Loot**
- Filter by **map / date / match**, with multiple sort options
- **Aggregate view** (default when a map is selected): all matches overlaid; click any event to drill into that match
- **Timeline / playback** for a single match (play/pause + speed)
- **Heatmap overlay**: combat / loot / traffic / storm
- Layer checkboxes to toggle each event type and paths independently

---

## Notes

- Parquet files have no `.parquet` extension but are valid parquet; pyarrow opens them by path.
- The `event` column is stored as bytes — the preprocessor decodes to UTF-8 strings.
- Bot detection: `user_id.isdigit()` (UUID = human, numeric string = bot).
- See `ARCHITECTURE.md` for coordinate-mapping walkthrough, assumptions, and tradeoffs.
- See `INSIGHTS.md` for three findings produced using this tool.
