# Architecture

## What I built and why

| Layer | Choice | Why |
|---|---|---|
| Preprocessor | Python + pyarrow | Reads parquet natively, handles the bytes-encoded `event` column, runs once at build time. |
| Frontend | Vanilla HTML/JS + 4-layer `<canvas>` | Zero build step, deploys as static files. Canvas is the right primitive for thousands of overlaid points; a framework would add weight without value. |
| Hosting | Static CDN (Vercel) | Everything is precomputed. No DB, no API, no server runtime. Cheapest, fastest, most reliable. |

## Data flow

```
player_data/*.nakama-0     (raw parquet — bytes-encoded events, 3D coords)
        │
        ▼  scripts/preprocess.py   (one-time)
        │   • decode event column from bytes
        │   • detect bot vs human by user_id shape (UUID vs digits)
        │   • project (x, z) → (px, py) per map config
        │   • normalize per-match ts to start at 0
        │   • group all participants of each match into one doc
        │   • write aggregate bundles per map and per map+date
        ▼
data/                                  (~13 MB, checked into repo)
  index.json                           match catalog
  summary.json                         global stats
  matches/{mid}.json                   one file per match (lazy-loaded)
  aggregate/{map}.json                 cross-match bundles (3 per-map + 15 per-map-per-date)
        │
        ▼  fetch() in app.js
        ▼
4-canvas stack: map · heatmap · events · hover-input
```

## Coordinate mapping (world → minimap)

The README gives a per-map config (`scale`, `origin_x`, `origin_z`). Conversion:

```
u = (x - origin_x) / scale            # 0..1 across width
v = (z - origin_z) / scale            # 0..1 across depth
pixel_x = u * 1024
pixel_y = (1 - v) * 1024              # Y is flipped: image origin top-left, world origin bottom-left
```

Pixel coordinates are precomputed in the preprocessor (once per event), not per-render. `y` (elevation) is dropped because the brief is a 2D minimap view. Out-of-bounds count after preprocessing: **0 events across all 1,243 files** — mapping is correct.

## Assumptions made (where the data was ambiguous)

1. **Files are short combat-window slices, not full match journeys.** 93% of matches have one file with a ~100–700 ms span (Position events at ~200 Hz). The "playback" timeline scrubs the slice, not a multi-minute match.
2. **`ts` is wall-clock time anonymized to ~Jan 21 1970**, not "ms elapsed since match start" as the README claims. Preprocessor normalizes per-match so the first event is `t = 0`.
3. **Bot vs human detection by `user_id` shape**: UUID = human, all-digit string = bot. Cross-checked against `Position` vs `BotPosition` events.
4. **PvP events come in pairs.** Each `Kill` is matched by a `Killed` at the same coords/ts — counted as 1 encounter.
5. **Participant counts are lower bounds.** Many matches have BotKill events but no bot files, and the 3 PvP matches imply unsampled humans. UI shows `≥N` prefix when the inferred minimum exceeds observed file count.
6. **Elevation (`y`) is dropped** for 2D rendering.
7. **Feb 14 is a partial day** — included as-is.

## Tradeoffs

| Considered | Chose | Why |
|---|---|---|
| Single big `events.json` | Per-match + per-aggregate files | 13 MB upfront is fine, 1 GB isn't. Lazy per-match loading + CDN caching. |
| React + charting lib | Vanilla canvas | Map view is bespoke; libraries don't help. Avoid the bundle. |
| WebGL (deck.gl) | 2D canvas additive blending | Dataset is small. 2D ships in 10 lines and looks the same to a Level Designer. |
| Query-parquet-in-browser (DuckDB-WASM) | Preprocess to JSON | ~10 MB WASM bundle for no benefit at this scale; preprocessing is faster end-to-end. |
| Cross-match continuous playback | Aggregate-only across matches | Each file is sub-second; there's no honest cross-match time axis. |
| Mobile-responsive layout | Desktop-only fixed sidebar | Audience is Level Designers at a desk. |

## How this scales

The preprocessor + per-match files work up to ~50k matches. Beyond that, swap the preprocessor for a small FastAPI + DuckDB backend that queries the parquet directly (DuckDB reads `s3://` natively), and precompute per-`(map, date, event_type)` heatmap tiles served from a CDN. Same frontend, same JSON shape, no rendering changes.
