# Insights — Three things the tool revealed about LILA BLACK

All numbers derived from the full 5-day dataset (1,243 files, 89,104 events, 796 matches) using the visualizer's filters + summary panel. Spot-check by opening the tool, applying the listed filters, and looking at the map.

---

## 1. PvP almost never happens — LILA BLACK is effectively a PvE shooter

**What caught my eye.** The header stat panel shows `3,115 PvE · 6 PvP` across all 5 days. When you flip the match list filter by date, the rare PvP matches (badged "⚔") are easy to spot — there are only **3** of them.

**Evidence.**
- 3,115 PvE combat events (BotKill + BotKilled) vs 6 PvP events (3 Kill + 3 Killed paired).
- **Only 3 of 796 matches (0.38%)** contain any PvP at all.
- The 3 PvP encounters: 2 on AmbroseValley, 1 on GrandRift, **0 on Lockdown** — surprising given Lockdown is the small/close-quarters map where you'd expect humans to bump into each other.
- Open the heatmap in "Combat density" mode on AmbroseValley with all dates selected — the orange/red bloom is entirely bots; the two PvP pins are isolated dots.

**Action.**
- **Investigate matchmaking.** Are humans being placed in lobbies alone with bot-fill? If so, the "battle royale" framing is misleading and either the matchmaker or the marketing needs to change.
- **Audit Lockdown.** A close-quarters map with zero PvP across 200+ matches suggests either matchmaking is putting solo humans in there, or geometry is funneling players away from each other.
- **Metrics affected:** PvP encounter rate per match, time-to-first-PvP-engagement, % of matches with at least one human kill.

**Why a Level Designer should care.** Map geometry is supposed to create encounters. If humans never meet on the small map, the chokepoints aren't doing their job — or matchmaking is starving them of opponents. Either way it's a design problem the team probably can't see without this visualization.

---

## 2. GrandRift is dramatically under-played vs the other two maps

**What caught my eye.** Toggle the Map filter through the three options and watch the match-list count: AmbroseValley shows hundreds, Lockdown shows fewer, GrandRift is a sliver. The summary panel confirms this in events-per-map.

**Evidence.**
- AmbroseValley: 61,213 events (~69% of all activity).
- Lockdown: 21,238 events (~24%).
- **GrandRift: 6,852 events (~7.7%).**
- Match counts skew the same way. GrandRift never gets more than a small fraction of any day's matches.

**Action.**
- **Check matchmaking weights.** Is GrandRift down-weighted in rotation, or is this organic player choice?
- **Run a survey or A/B test the weights** to find out whether GrandRift is unpopular (signal) or starved (artifact).
- If unpopular, **audit GrandRift's POI layout vs AmbroseValley's** — load both maps in the tool, switch heatmap to "Loot density," and compare. Sparse loot zones explain why players bypass a map.
- **Metrics affected:** match-distribution-per-map (target: more even), per-map DAU, GrandRift retention.

**Why a Level Designer should care.** A map that gets 1/9th the play of its siblings is essentially dead content. Either fix the matchmaker (cheap) or fix the map (expensive) — but you need to know which one first.

---

## 3. Looting dominates the gameplay loop — players are economy-driven, not combat-driven

**What caught my eye.** Switch the heatmap to "Loot density" on AmbroseValley with all dates — large dense clusters appear in specific POIs. Switch to "Combat density" and the heat is sparser. Loot events outnumber combat 4 to 1.

**Evidence.**
- 12,885 Loot events vs 3,121 total combat events. Loot is **14.5% of all events** — bigger than all combat combined.
- Loot:Position ratio per map:
  - AmbroseValley: 0.27 (loot is rich)
  - GrandRift: 0.24
  - **Lockdown: 0.18** (players move more, loot less — fewer pickups per minute of movement)
- The loot heatmap on each map shows clear clustering at specific POIs; the spaces between are dead.

**Action.**
- **Audit cold POIs.** Use the loot heatmap to identify which areas of each map are loot deserts. Either add loot or remove the visual prominence of those areas to stop drawing players there.
- **Re-balance Lockdown's loot density.** Lockdown's low loot:position ratio means players are moving without reward — either reduce travel distance between loot zones or add more loot.
- **Don't tune bots assuming combat is the loop.** Players' time budget is mostly loot. Combat is the seasoning, not the meal.
- **Metrics affected:** loot-events-per-player-minute, POI-coverage %, extraction success rate (proxy: matches without death events).

**Why a Level Designer should care.** Level design budgets often go into combat sightlines and cover. This data says the actual primary activity is loot routing. If the map's loot graph (POI → POI travel + reward) is broken, no amount of cover-arc work will fix the player experience.

---

### Honorable mention (didn't make the top 3 but worth flagging)

- **Bots are easy.** Humans kill bots 3.45× more often than bots kill humans (2,415 vs 700). If combat tension is a design goal, bot AI / TTK needs to come up.
- **Daily activity is declining ~35%/day across launch week.** Feb 10 → 13: 33,687 → 11,106 events. Not a level-design problem directly, but worth flagging to the product team.
- **Storm is nearly harmless** — 39 storm deaths across 796 matches. Either the storm is too lenient or players extract before it threatens them.
