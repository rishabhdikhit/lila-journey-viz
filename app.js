// LILA BLACK Player Journey Visualizer
// Pure vanilla JS, four-layer canvas stack (minimap | heatmap | events | hover)

const $ = (q) => document.querySelector(q);

const state = {
  index: null,
  summary: null,
  match: null,          // currently loaded match doc (single mode)
  aggregate: null,      // currently loaded aggregate doc (aggregate mode)
  aggregateMode: false,
  filteredMatches: [],
  mapImage: null,
  mapCfg: null,
  // playback
  playing: false,
  playT: 0,
  playSpeed: 1,
  lastFrameAt: 0,
};

const MAP_FILES = {
  AmbroseValley: "minimaps/AmbroseValley_Minimap.png",
  GrandRift:     "minimaps/GrandRift_Minimap.png",
  Lockdown:      "minimaps/Lockdown_Minimap.jpg",
};

const EVENT_STYLE = {
  Kill:          { color: "#ff3848", shape: "x",      size: 11, z: 10 },
  Killed:        { color: "#ff8a8a", shape: "tri",    size: 10, z: 9 },
  BotKill:       { color: "#ffa726", shape: "x",      size: 7,  z: 6 },
  BotKilled:     { color: "#ffcc7a", shape: "tri",    size: 7,  z: 6 },
  KilledByStorm: { color: "#b388ff", shape: "star",   size: 10, z: 7 },
  Loot:          { color: "#4caf50", shape: "square", size: 5,  z: 4 },
};

// Active data source — single match doc OR aggregate doc
function activeSource() {
  return state.aggregateMode ? state.aggregate : state.match;
}

// ---------------- bootstrap ----------------
async function boot() {
  const [index, summary] = await Promise.all([
    fetch("data/index.json").then(r => r.json()),
    fetch("data/summary.json").then(r => r.json()),
  ]);
  state.index = index;
  state.summary = summary;

  initFilters();
  initControls();
  renderSummary();
  applyFilters();

  // Default to AmbroseValley aggregate (most-played map) so the user
  // sees something meaningful on first paint.
  $("#filter-map").value = "AmbroseValley";
  applyFilters();
  onFilterChange();
}

function updateAggregateHint() {
  const map = $("#filter-map").value;
  const hint = $("#aggregate-hint");
  const btn = $("#view-aggregate");
  if (!map) {
    hint.textContent = "Pick a map to see all matches combined; pick a match below to drill in.";
    btn.disabled = true;
  } else {
    const date = $("#filter-date").value;
    const tag = date ? `${map} · ${date}` : `${map} · all dates`;
    hint.textContent = `Aggregate available: ${tag} (${state.filteredMatches.length} matches).`;
    btn.disabled = false;
  }
}

function renderSummary() {
  const s = state.summary;
  $("#summary-stats").textContent =
    `${s.total_matches} matches  ·  ${s.total_events.toLocaleString()} events  ·  ` +
    `${s.pve_combat} PvE  ·  ${s.pvp_combat} PvP  ·  ${Object.keys(s.events_per_map).length} maps`;
}

function initFilters() {
  const mapSel  = $("#filter-map");
  const dateSel = $("#filter-date");
  (state.index.maps || []).forEach(m => mapSel.add(new Option(m, m)));
  (state.index.dates || []).forEach(d => dateSel.add(new Option(d, d)));
  if (!(state.index.dates || []).length) {
    dateSel.disabled = true;
    dateSel.title = "No dates available from the data source";
  } else {
    dateSel.disabled = false;
    dateSel.title = "";
  }

  mapSel.addEventListener("change", () => { applyFilters(); onFilterChange(); });
  dateSel.addEventListener("change", () => { applyFilters(); onFilterChange(); });

  $("#filter-match").addEventListener("change", (e) => {
    const m = state.filteredMatches.find(m => m.safe_id === e.target.value);
    if (m) selectMatch(m);
  });
  $("#match-sort").addEventListener("change", () => {
    applyFilters();   // re-sort + re-render dropdown
  });
}

function onFilterChange() {
  const map = $("#filter-map").value;
  // If a map is filtered, auto-load aggregate (all matches on that map + optional date).
  // If no map filter, default to single-match mode on the busiest match.
  if (map) {
    state.aggregateMode = true;
    loadAggregate();
  } else if (state.filteredMatches.length) {
    state.aggregateMode = false;
    selectMatch(state.filteredMatches[0]);
  } else {
    state.match = null;
    state.aggregate = null;
    redrawAll();
    $("#match-details").textContent = "No matches for these filters.";
    $("#map-banner").innerHTML = "";
  }
}

const SORTERS = {
  events_desc:   (a, b) => b.events - a.events,
  events_asc:    (a, b) => a.events - b.events,
  humans_desc:   (a, b) => b.humans - a.humans || b.events - a.events,
  bots_desc:     (a, b) => b.bots - a.bots     || b.events - a.events,
  duration_desc: (a, b) => b.duration_ms - a.duration_ms,
  duration_asc:  (a, b) => a.duration_ms - b.duration_ms,
  date_desc:     (a, b) => b.date.localeCompare(a.date) || b.events - a.events,
  date_asc:      (a, b) => a.date.localeCompare(b.date) || b.events - a.events,
  pvp_first:     (a, b) => (b.has_pvp - a.has_pvp) || b.events - a.events,
};

function applyFilters() {
  const map = $("#filter-map").value;
  const date = $("#filter-date").value;
  const sortKey = $("#match-sort") ? $("#match-sort").value : "events_desc";
  state.filteredMatches = state.index.matches.filter(m =>
    (!map || m.map === map) && (!date || m.date === date)
  );
  state.filteredMatches.sort(SORTERS[sortKey] || SORTERS.events_desc);

  const sel = $("#filter-match");
  sel.innerHTML = "";
  state.filteredMatches.forEach(m => {
    const tag = m.has_pvp ? "  ⚔" : "";
    const dur = (m.duration_ms / 1000).toFixed(2) + "s";
    // Show MIN inferred counts; prefix with ≥ when the true count exceeds observed.
    // Honest reading: "at least N humans / N bots were in this match".
    const humanCol = m.humans_min > m.humans
      ? `≥${String(m.humans_min).padStart(2)}`
      : ` ${String(m.humans).padStart(2)}`;
    const botCol = m.bots_min > m.bots
      ? `≥${String(m.bots_min).padStart(2)}`
      : ` ${String(m.bots).padStart(2)}`;
    const label =
      `${m.map.padEnd(14)} ${m.date.padEnd(11)}  ` +
      `h${humanCol}/b${botCol}  ` +
      `${String(m.events).padStart(5)}ev  ` +
      `${dur.padStart(6)}${tag}`;
    const opt = new Option(label, m.safe_id);
    opt.title =
      `Match: ${m.id}\n\n` +
      `Humans observed (files):  ${m.humans}\n` +
      `Humans min (inferred):    ${m.humans_min}\n` +
      `Bots observed (files):    ${m.bots}\n` +
      `Bots min (inferred):      ${m.bots_min}\n\n` +
      `PvP encounters:           ${m.pvp_encounters} (${m.pvp_combat} events)\n` +
      `Bot combat events:        ${m.bot_combat}\n` +
      `Loot: ${m.loot}    Storm: ${m.storm}`;
    opt.title = m.id;
    if (m.has_pvp) opt.style.color = "#ff8a8a";
    sel.add(opt);
  });
  $("#match-count").textContent = `(${state.filteredMatches.length})`;
  if (typeof updateAggregateHint === "function") updateAggregateHint();
}

function getLayers() {
  const layers = {};
  document.querySelectorAll("[data-layer]").forEach(el => {
    layers[el.dataset.layer] = el.checked;
  });
  return layers;
}

function initControls() {
  document.querySelectorAll("[data-layer]").forEach(el => {
    el.addEventListener("change", redrawAll);
  });
  $("#layers-all").addEventListener("click", () => {
    document.querySelectorAll("[data-layer]").forEach(el => el.checked = true);
    redrawAll();
  });
  $("#layers-none").addEventListener("click", () => {
    document.querySelectorAll("[data-layer]").forEach(el => el.checked = false);
    redrawAll();
  });
  $("#heatmap-mode").addEventListener("change", redrawAll);

  $("#view-aggregate").addEventListener("click", () => {
    if ($("#view-aggregate").disabled) return;
    state.aggregateMode = true;
    loadAggregate();
  });

  $("#play-btn").addEventListener("click", togglePlay);
  $("#timeline").addEventListener("input", (e) => {
    if (!state.match) return;
    state.playT = (e.target.value / 1000) * state.match.duration_ms;
    updateTimelineLabel();
    drawEvents();
  });
  $("#speed").addEventListener("change", (e) => { state.playSpeed = parseFloat(e.target.value); });

  // Tooltip on hover over event markers; click in aggregate mode → drill into match
  $("#hover-canvas").addEventListener("mousemove", onHover);
  $("#hover-canvas").addEventListener("mouseleave", () => {
    $("#tooltip").hidden = true;
    $("#hover-canvas").style.cursor = "default";
  });
  $("#hover-canvas").addEventListener("click", onClick);

  window.addEventListener("resize", () => requestAnimationFrame(redrawAll));
}

// ---------------- aggregate mode ----------------
async function loadAggregate() {
  const map = $("#filter-map").value;
  if (!map) return;
  const date = $("#filter-date").value;
  document.querySelectorAll('[data-layer="humanPath"], [data-layer="botPath"]').forEach(el => el.checked = false);
  try {
    const file = date
      ? `data/aggregate/${map}__${date}.json`
      : `data/aggregate/${map}.json`;
    const doc = await fetch(file).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    state.aggregate = doc;
    state.match = null;
    state.mapCfg = state.index.map_config[doc.map_id];

    state.mapImage = new Image();
    state.mapImage.onload = () => redrawAll();
    state.mapImage.src = MAP_FILES[doc.map_id];

    const dateLabel = doc.date === "all" ? "all dates" : doc.date;
    $("#map-banner").innerHTML =
      `<b>${doc.map_id}</b> · ${dateLabel} · <b>${doc.match_count}</b> matches aggregated · ` +
      `${doc.events.length} non-position events ` +
      `<span class="agg-badge">AGGREGATE</span>`;

    const ec = doc.event_counts;
    const lines = [
      `Mode  : AGGREGATE`,
      `Map   : ${doc.map_id}`,
      `Date  : ${dateLabel}`,
      `Matches aggregated: ${doc.match_count}`,
      `Non-position events: ${doc.events.length}`,
      ``,
      `Events:`,
      ...Object.entries(ec).map(([k, v]) => `  ${k.padEnd(15)} ${v}`),
    ];
    $("#match-details").textContent = lines.join("\n");

    // No meaningful timeline across matches
    $("#timeline").disabled = true;
    $("#play-btn").disabled = true;
    $("#timeline-label").textContent = "—";
  } catch (e) {
    $("#match-details").textContent = "Failed to load aggregate: " + e;
  }
}

// ---------------- match selection ----------------
async function selectMatch(meta) {
  // Picking a specific match always switches to single-match mode
  state.aggregateMode = false;
  state.aggregate = null;
  // re-enable paths when drilling into a single match
  document.querySelectorAll('[data-layer="humanPath"], [data-layer="botPath"]').forEach(el => el.checked = true);
  $("#filter-match").value = meta.safe_id;
  $("#timeline").disabled = false;
  $("#play-btn").disabled = false;
  const doc = await fetch(`data/matches/${meta.safe_id}.json`).then(r => r.json());
  state.match = doc;
  state.mapCfg = state.index.map_config[doc.map_id];
  state.playT = doc.duration_ms;  // start at end (full match visible)

  // Load minimap
  state.mapImage = new Image();
  state.mapImage.onload = () => redrawAll();
  state.mapImage.src = MAP_FILES[doc.map_id];

  // Banner + details
  const pvpBadge = meta.has_pvp ? `<span class="pvp-badge">PvP ENCOUNTER</span>` : "";
  const pvpCombat = (doc.event_counts.Kill || 0) + (doc.event_counts.Killed || 0);
  const botCombat = (doc.event_counts.BotKill || 0) + (doc.event_counts.BotKilled || 0);
  const pvpEnc = Math.ceil(pvpCombat / 2);
  const humansMin = doc.humans.length + (pvpEnc > 0 ? 1 : 0);
  const botsMin   = Math.max(doc.bots.length, botCombat > 0 ? 1 : 0);
  const humanLabel = humansMin > doc.humans.length
    ? `≥${humansMin} humans (${doc.humans.length} with files, +≥1 from PvP)`
    : `${doc.humans.length} human${doc.humans.length === 1 ? "" : "s"}`;
  const botLabel = botsMin > doc.bots.length
    ? `≥${botsMin} bots (${doc.bots.length} with files, ${botCombat} combat events)`
    : `${doc.bots.length} bot${doc.bots.length === 1 ? "" : "s"}`;
  $("#map-banner").innerHTML =
    `<b>${doc.map_id}</b>  ·  ${doc.date}  ·  match <code>${doc.match_id.slice(0,8)}…</code>  ·  ` +
    `${humanLabel} / ${botLabel}  ·  ${doc.events.length} events  ·  ` +
    `${(doc.duration_ms/1000).toFixed(2)}s span ${pvpBadge}`;

  const ec = doc.event_counts;
  const lines = [
    `Match : ${doc.match_id}`,
    `Map   : ${doc.map_id}`,
    `Date  : ${doc.date}`,
    `Span  : ${doc.duration_ms} ms`,
    `Humans: ${doc.humans.length}  Bots: ${doc.bots.length}`,
    ``,
    `Events:`,
    ...Object.entries(ec).map(([k, v]) => `  ${k.padEnd(15)} ${v}`),
  ];
  $("#match-details").textContent = lines.join("\n");

  $("#timeline").value = 1000;
  updateTimelineLabel();
}

function updateTimelineLabel() {
  if (!state.match) { $("#timeline-label").textContent = "—"; return; }
  $("#timeline-label").textContent = `${state.playT.toFixed(0)} / ${state.match.duration_ms} ms`;
}

// ---------------- drawing ----------------
function redrawAll() {
  drawMap();
  drawHeatmap();
  drawEvents();
}

function drawMap() {
  const c = $("#map-canvas"), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (state.mapImage && state.mapImage.complete) {
    ctx.drawImage(state.mapImage, 0, 0, c.width, c.height);
  } else {
    ctx.fillStyle = "#0e1117"; ctx.fillRect(0, 0, c.width, c.height);
  }
}

function drawEvents() {
  const c = $("#event-canvas"), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const source = activeSource();
  if (!source) return;

  const L = getLayers();
  const cutoff = state.aggregateMode ? Infinity : state.playT;

  // Group events by player for path drawing
  const byPlayer = new Map();
  for (const e of source.events) {
    if (e.t !== undefined && e.t > cutoff) continue;
    if (!byPlayer.has(e.uid)) byPlayer.set(e.uid, []);
    byPlayer.get(e.uid).push(e);
  }

  // Player paths — single-match mode only; per-uid bot/human toggle
  if (!state.aggregateMode) {
    byPlayer.forEach((evs) => {
      const bot = evs[0].bot;
      if (bot && !L.botPath) return;
      if (!bot && !L.humanPath) return;
      const positions = evs.filter(e => e.e === "Position" || e.e === "BotPosition");
      if (positions.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(positions[0].px, positions[0].py);
      for (let i = 1; i < positions.length; i++) {
        ctx.lineTo(positions[i].px, positions[i].py);
      }
      ctx.strokeStyle = bot ? "rgba(255,235,59,0.85)" : "rgba(77,171,247,0.85)";
      ctx.lineWidth = bot ? 1.4 : 1.8;
      if (bot) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Event markers — filter by per-type layer toggle
  const markerEvents = [];
  for (const e of source.events) {
    if (e.t !== undefined && e.t > cutoff) continue;
    if (e.e === "Position" || e.e === "BotPosition") continue;
    if (!L[e.e]) continue;  // layer turned off
    markerEvents.push(e);
  }
  markerEvents.sort((a, b) => (EVENT_STYLE[a.e]?.z || 0) - (EVENT_STYLE[b.e]?.z || 0));
  for (const e of markerEvents) drawMarker(ctx, e);
}

function drawMarker(ctx, e) {
  const s = EVENT_STYLE[e.e];
  if (!s) return;
  ctx.fillStyle = s.color;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.4;
  const r = s.size;
  ctx.beginPath();
  if (s.shape === "x") {
    ctx.moveTo(e.px - r, e.py - r); ctx.lineTo(e.px + r, e.py + r);
    ctx.moveTo(e.px + r, e.py - r); ctx.lineTo(e.px - r, e.py + r);
    ctx.strokeStyle = s.color; ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
    ctx.stroke();
  } else if (s.shape === "tri") {
    ctx.moveTo(e.px, e.py - r);
    ctx.lineTo(e.px - r, e.py + r);
    ctx.lineTo(e.px + r, e.py + r);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else if (s.shape === "square") {
    ctx.rect(e.px - r, e.py - r, r * 2, r * 2);
    ctx.fill(); ctx.stroke();
  } else if (s.shape === "star") {
    drawStar(ctx, e.px, e.py, 5, r, r / 2);
    ctx.fill(); ctx.stroke();
  } else {
    ctx.arc(e.px, e.py, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

function drawStar(ctx, cx, cy, spikes, outer, inner) {
  let rot = -Math.PI / 2, step = Math.PI / spikes;
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer); rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner); rot += step;
  }
  ctx.lineTo(cx, cy - outer);
  ctx.closePath();
}

// ---------------- heatmap ----------------
function drawHeatmap() {
  const c = $("#heat-canvas"), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  const mode = $("#heatmap-mode").value;
  if (mode === "off") return;
  const source = activeSource();
  if (!source) return;

  // Filter source events for the mode
  let points;
  if (mode === "combat") {
    points = source.events.filter(e =>
      ["Kill","Killed","BotKill","BotKilled"].includes(e.e));
  } else if (mode === "loot") {
    points = source.events.filter(e => e.e === "Loot");
  } else if (mode === "storm") {
    points = source.events.filter(e => e.e === "KilledByStorm");
  } else if (mode === "traffic") {
    points = source.events;
  }
  if (!points || !points.length) return;

  // Naive heatmap: stamp radial gradient at each point, additive blending
  const off = document.createElement("canvas");
  off.width = c.width; off.height = c.height;
  const octx = off.getContext("2d");
  octx.globalCompositeOperation = "lighter";
  const radius = mode === "traffic" ? 14 : 28;

  for (const p of points) {
    const g = octx.createRadialGradient(p.px, p.py, 0, p.px, p.py, radius);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    octx.fillStyle = g;
    octx.beginPath();
    octx.arc(p.px, p.py, radius, 0, Math.PI * 2);
    octx.fill();
  }

  // Colorize the alpha channel into a heat ramp
  const img = octx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 3] / 255;  // intensity 0..1
    if (v === 0) continue;
    const [r, g, b] = heatColor(v);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = Math.min(255, v * 200);
  }
  ctx.putImageData(img, 0, 0);
}

function heatColor(t) {
  // 0 -> dark blue, 0.5 -> orange, 1 -> red/white
  const stops = [
    [0.0, [  0,  40, 120]],
    [0.3, [  0, 180, 220]],
    [0.5, [ 80, 220,  80]],
    [0.7, [255, 180,  40]],
    [0.9, [255,  60,  60]],
    [1.0, [255, 240, 200]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map(j => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------- playback ----------------
function togglePlay() {
  state.playing = !state.playing;
  $("#play-btn").textContent = state.playing ? "❚❚" : "▶";
  if (state.playing) {
    if (state.match && state.playT >= state.match.duration_ms) state.playT = 0;
    state.lastFrameAt = performance.now();
    requestAnimationFrame(playLoop);
  }
}

function playLoop(now) {
  if (!state.playing || !state.match) return;
  const dt = now - state.lastFrameAt;
  state.lastFrameAt = now;
  state.playT += dt * state.playSpeed;
  if (state.playT >= state.match.duration_ms) {
    state.playT = state.match.duration_ms;
    state.playing = false;
    $("#play-btn").textContent = "▶";
  }
  $("#timeline").value = (state.playT / state.match.duration_ms) * 1000;
  updateTimelineLabel();
  drawEvents();
  if (state.playing) requestAnimationFrame(playLoop);
}

// ---------------- hover + click ----------------
function findEventNear(e) {
  const source = activeSource();
  if (!source) return null;
  const c = $("#hover-canvas");
  const rect = c.getBoundingClientRect();
  const scaleX = c.width  / rect.width;
  const scaleY = c.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top)  * scaleY;

  const cutoff = state.aggregateMode ? Infinity : state.playT;
  let best = null, bestDist = 18 * 18;
  for (const ev of source.events) {
    if (ev.t !== undefined && ev.t > cutoff) continue;
    if (ev.e === "Position" || ev.e === "BotPosition") continue;
    const dx = ev.px - mx, dy = ev.py - my;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = ev; }
  }
  return best;
}

function onHover(e) {
  const best = findEventNear(e);
  state.hoverEvent = best;
  const tt = $("#tooltip");
  if (best) {
    tt.hidden = false;
    tt.style.left = (e.clientX + 12) + "px";
    tt.style.top  = (e.clientY + 12) + "px";
    const who = best.bot ? `bot ${best.uid}` : `human ${best.uid.slice(0,8)}…`;
    const tline = best.t !== undefined
      ? `t = ${best.t} ms`
      : (best.mid ? `match <code>${best.mid.slice(0,8)}…</code><br><i>click → open match</i>` : "");
    tt.innerHTML =
      `<b>${best.e}</b><br>${who}<br>` +
      `world (${best.x.toFixed(1)}, ${best.z.toFixed(1)})<br>` +
      tline;
    $("#hover-canvas").style.cursor = (state.aggregateMode && best.mid) ? "pointer" : "crosshair";
  } else {
    tt.hidden = true;
    $("#hover-canvas").style.cursor = "default";
  }
}

function onClick(e) {
  if (!state.aggregateMode) return;
  const target = findEventNear(e) || state.hoverEvent;
  if (!target || !target.mid) return;
  const mid = target.mid;
  const safe_id = mid.replace(".nakama-0", "");
  const meta = state.filteredMatches.find(m => m.id === mid)
            || state.index.matches.find(m => m.id === mid)
            || { id: mid, safe_id, map: $("#filter-map").value, date: "", has_pvp: false };
  selectMatch(meta);
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:20px;color:#f88">Failed to load:\n${err}</pre>`;
});
