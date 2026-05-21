"""
Preprocess LILA BLACK parquet telemetry into web-ready JSON.

Input : player_data/ folder with February_10..14 subfolders
Output:
  data/index.json            -- match catalog for filter dropdowns
  data/matches/{mid}.json    -- one file per match, all participants combined
  data/summary.json          -- global stats for the dashboard panel

Run:
  python preprocess.py --src "/path/to/player_data" --out "../data"
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow.parquet as pq

MAP_CFG = {
    "AmbroseValley": {"scale": 900,  "origin_x": -370, "origin_z": -473},
    "GrandRift":     {"scale": 581,  "origin_x": -290, "origin_z": -290},
    "Lockdown":      {"scale": 1000, "origin_x": -500, "origin_z": -500},
}

IMG_PX = 1024  # all minimaps are 1024x1024


def is_bot(user_id: str) -> bool:
    return user_id.isdigit()


def to_pixel(x: float, z: float, cfg: dict):
    """Map world (x,z) onto a 1024x1024 minimap. Y is flipped."""
    u = (x - cfg["origin_x"]) / cfg["scale"]
    v = (z - cfg["origin_z"]) / cfg["scale"]
    return u * IMG_PX, (1 - v) * IMG_PX


def read_parquet(path: Path):
    df = pq.read_table(str(path)).to_pandas()
    df["event"] = df["event"].apply(
        lambda b: b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else b
    )
    return df


def process(src: Path, out: Path):
    matches = defaultdict(list)   # match_id -> list of row dicts
    match_meta = {}               # match_id -> {map_id, date}
    global_events = Counter()
    events_per_map = defaultdict(Counter)
    matches_per_day = defaultdict(set)
    oob = 0
    bad = 0
    total_files = 0

    for day_dir in sorted(src.iterdir()):
        if not day_dir.is_dir():
            continue
        date_str = day_dir.name.replace("_", "-")  # February_10 -> February-10
        for f in day_dir.iterdir():
            if f.suffix == ".md" or f.name.startswith("."):
                continue
            try:
                df = read_parquet(f)
            except Exception:
                bad += 1
                continue
            if df.empty:
                continue
            total_files += 1

            uid = str(df["user_id"].iloc[0])
            mid = str(df["match_id"].iloc[0])
            mapid = str(df["map_id"].iloc[0])
            bot = is_bot(uid)

            cfg = MAP_CFG.get(mapid)
            if cfg is None:
                continue

            ts_ms = (df["ts"].astype("int64") // 1_000_000).astype("int64")
            ts0 = int(ts_ms.min())  # normalize ts within match later

            for _, r in df.iterrows():
                px, py = to_pixel(float(r["x"]), float(r["z"]), cfg)
                if px < 0 or px > IMG_PX or py < 0 or py > IMG_PX:
                    oob += 1
                event_str = r["event"]
                row = {
                    "uid": uid,
                    "bot": bot,
                    "x": round(float(r["x"]), 2),
                    "z": round(float(r["z"]), 2),
                    "px": round(px, 1),
                    "py": round(py, 1),
                    "t": int(int(r["ts"].value) // 1_000_000),  # raw ts ms
                    "e": event_str,
                }
                matches[mid].append(row)
                global_events[event_str] += 1
                events_per_map[mapid][event_str] += 1

            match_meta.setdefault(mid, {"map_id": mapid, "date": date_str})
            matches_per_day[date_str].add(mid)

    # Normalize per-match ts so the first event is t=0 (helps the playback slider)
    out_matches = out / "matches"
    out_matches.mkdir(parents=True, exist_ok=True)
    index = []

    for mid, rows in matches.items():
        rows.sort(key=lambda r: r["t"])
        t0 = rows[0]["t"]
        for r in rows:
            r["t"] = r["t"] - t0  # ms from match start (anchor = earliest event)

        meta = match_meta[mid]
        humans = sorted({r["uid"] for r in rows if not r["bot"]})
        bots = sorted({r["uid"] for r in rows if r["bot"]})
        evcounts = Counter(r["e"] for r in rows)

        match_doc = {
            "match_id": mid,
            "map_id": meta["map_id"],
            "date": meta["date"],
            "humans": humans,
            "bots": bots,
            "duration_ms": rows[-1]["t"] if rows else 0,
            "event_counts": dict(evcounts),
            "events": rows,
        }

        safe_mid = mid.replace(".nakama-0", "").replace("/", "_")
        (out_matches / f"{safe_mid}.json").write_text(
            json.dumps(match_doc, separators=(",", ":"))
        )

        pvp_combat  = evcounts.get("Kill", 0) + evcounts.get("Killed", 0)
        bot_combat  = evcounts.get("BotKill", 0) + evcounts.get("BotKilled", 0)
        loot_count  = evcounts.get("Loot", 0)
        storm_count = evcounts.get("KilledByStorm", 0)
        has_pvp     = pvp_combat > 0

        # Lower-bound "actual" participant counts inferred from combat events.
        # We can never know the true population (data is sampled per-file), but
        # combat events prove a participant existed even when no file was logged.
        # Conservative rule: PvP encounters are paired (Kill+Killed at same ts/coord)
        # so pvp_combat events ~= 2 * encounters; each encounter implies >=1 extra human.
        # Bot combat events could all involve the same bot, so we only infer >=1 bot.
        pvp_encounters = pvp_combat // 2 if pvp_combat % 2 == 0 else (pvp_combat + 1) // 2
        humans_min = max(len(humans), len(humans) + (1 if pvp_encounters > 0 else 0))
        bots_min   = max(len(bots),   1 if bot_combat > 0 else 0)

        index.append({
            "id": mid,
            "safe_id": safe_mid,
            "map": meta["map_id"],
            "date": meta["date"],
            "humans": len(humans),           # humans with their own file present
            "bots": len(bots),               # bots with their own file present
            "humans_min": humans_min,        # lower-bound true human count
            "bots_min": bots_min,            # lower-bound true bot count
            "pvp_combat": pvp_combat,        # Kill + Killed events
            "pvp_encounters": pvp_encounters,
            "bot_combat": bot_combat,        # BotKill + BotKilled events
            "loot": loot_count,
            "storm": storm_count,
            "events": len(rows),
            "duration_ms": match_doc["duration_ms"],
            "has_pvp": has_pvp,
        })

    # Sort index: most events first, so the "demo" match floats to the top
    index.sort(key=lambda m: (-m["events"], m["date"], m["id"]))

    (out / "index.json").write_text(json.dumps({
        "matches": index,
        "maps": list(MAP_CFG.keys()),
        "dates": sorted(matches_per_day.keys()),
        "map_config": MAP_CFG,
    }, indent=2))

    # Aggregate bundles: per-map and per-map-per-date.
    # Used by the frontend's "Aggregate" view (cross-match heatmaps + markers).
    out_agg = out / "aggregate"
    out_agg.mkdir(parents=True, exist_ok=True)
    by_map = defaultdict(list)
    by_map_date = defaultdict(list)
    for mid, rows in matches.items():
        meta = match_meta[mid]
        mapid = meta["map_id"]
        date  = meta["date"]
        for r in rows:
            # Skip Position/BotPosition in aggregate to keep payload manageable;
            # cross-match paths are noise anyway. Keep all combat/loot/storm.
            if r["e"] in ("Position", "BotPosition"):
                continue
            slim = {
                "uid": r["uid"], "bot": r["bot"],
                "px": r["px"], "py": r["py"],
                "x": r["x"], "z": r["z"],
                "e": r["e"], "mid": mid,
            }
            by_map[mapid].append(slim)
            by_map_date[(mapid, date)].append(slim)

    for mapid, evs in by_map.items():
        (out_agg / f"{mapid}.json").write_text(json.dumps({
            "map_id": mapid,
            "date": "all",
            "match_count": sum(1 for m in matches if match_meta[m]["map_id"] == mapid),
            "event_counts": dict(Counter(e["e"] for e in evs)),
            "events": evs,
        }, separators=(",", ":")))

    for (mapid, date), evs in by_map_date.items():
        (out_agg / f"{mapid}__{date}.json").write_text(json.dumps({
            "map_id": mapid,
            "date": date,
            "match_count": sum(
                1 for m in matches
                if match_meta[m]["map_id"] == mapid and match_meta[m]["date"] == date
            ),
            "event_counts": dict(Counter(e["e"] for e in evs)),
            "events": evs,
        }, separators=(",", ":")))

    total_events = sum(global_events.values())
    summary = {
        "total_files": total_files,
        "skipped_files": bad,
        "total_events": total_events,
        "total_matches": len(matches),
        "events": dict(global_events.most_common()),
        "events_per_map": {k: dict(v) for k, v in events_per_map.items()},
        "matches_per_day": {k: len(v) for k, v in matches_per_day.items()},
        "out_of_bounds_events": oob,
        "pvp_combat": global_events.get("Kill", 0) + global_events.get("Killed", 0),
        "pve_combat": global_events.get("BotKill", 0) + global_events.get("BotKilled", 0),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"OK  files={total_files} skipped={bad}")
    print(f"OK  matches={len(matches)} events={total_events} oob={oob}")
    print(f"OK  wrote {out / 'index.json'}")
    print(f"OK  wrote {out / 'summary.json'}")
    print(f"OK  wrote {len(matches)} per-match files into {out_matches}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Path to player_data folder")
    ap.add_argument("--out", required=True, help="Output data folder")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    process(src, out)


if __name__ == "__main__":
    main()
