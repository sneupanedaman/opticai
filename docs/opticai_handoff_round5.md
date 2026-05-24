# OpticAI — Session Handoff Document
**Date:** May 24, 2026
**Session:** Round 5 — VS Code Setup, Column Mapping UI Fixes, Chat Restored

---

## What OpticAI Is

An AI-powered analytics tool for multi-location restaurant operators. Upload CSV exports (sales, labor, food cost, PMIX, inventory, guest satisfaction) and ask plain-English questions to get root-cause answers, KPI dashboards, and weekly ops briefings — no BI setup required.

**Live URL:** opticai.vercel.app
**Repo:** github.com/sneupanedaman/opticai
**Stack:** Static HTML frontend (`app.html`) + Vercel serverless functions (`api/`) + Anthropic API

---

## What Was Done This Session

### 1. Repo cloned to local / VS Code
Cloned `github.com/sneupanedaman/opticai` to `C:\Users\santo\OneDrive\Documents\programs\opticai`. Git identity configured (`sneupanedaman / sanpane@gmail.com`). All pushes confirmed working.

### 2. Free-text custom definition input for unmapped columns
Previously, when the resolver found an unrecognized CSV column, users could only pick from a preset list of 22 known concepts or click "Something else / ignore." Now:
- A text input + **"Use this"** button appears below the concept list
- User can type any custom definition (e.g. "Delivery fee", "Waste cost")
- Enter key also submits
- Empty submission flashes red border + refocuses input
- Custom definition stored in `resolvedSchemas[type].resolved` with a `customLabel` field so the model sees the human-readable label, not a slug
- Stored in `learnedAliases` (`custom_<col_name>` → [col]) so subsequent uploads in the same session auto-resolve the same column name without re-asking
- Applied retroactively to any already-loaded schema containing the same unmapped column
- "Something else / ignore" renamed to plain "Ignore this column"

### 3. Fixed broken onclick handlers across all column mapping UIs (critical bug)
**Root cause:** `JSON.stringify(remaining)` embedded inside `onclick="..."` attributes produced `["col","col2"]` — the double quotes broke the HTML attribute, making every button a silent no-op.

**Fix:** Compute `remainingJson = JSON.stringify(remaining).replace(/"/g, '&quot;')` once per function and use it in all onclick/onkeydown attributes. The browser decodes `&quot;` back to `"` before evaluating JS, so the array arrives correctly.

Affected functions fixed:
- `checkAmbiguousColumns` (legacy hardcoded ambiguous flow)
- `checkAmbiguousColumnsFromSchema` (schema-driven ambiguous flow)
- `checkUnmappedColumnsFromSchema` (unmapped column flow — 4 occurrences)

### 4. Free-text option added to ambiguous column UI
`checkAmbiguousColumnsFromSchema` (used when a column partially matches multiple known concepts — e.g. `item_qty` in PMIX) previously showed only scored suggestion buttons with no escape hatch. Now it has the same free-text input + "Use this" + "Ignore" section as the unmapped flow.

New function added: `resolveAmbiguityFromSchemaCustom(col, filename, remaining)` — reads the input, creates `custom_<col>` canonId, stores with `customLabel`, updates `learnedAliases`, chains to next column.

`resolveAmbiguityFromSchema` updated to handle `__ignore__` action.

### 5. Fixed chat — retired model ID
All chat calls were returning "Sorry, I had trouble with that. Try again." because the model ID `claude-sonnet-4-5` has been retired. Updated both call sites in `app.html` to `claude-sonnet-4-6`.

### 6. Fixed chat — missing Anthropic SDK dependency
`api/package.json` only listed `nodemailer`. `chat.js` requires `@anthropic-ai/sdk` but it was absent, so Vercel never installed it and every `/api/chat` request crashed on import before reaching the API. Added `"@anthropic-ai/sdk": "^0.39.0"` to dependencies.

---

## Current State (after this session)

| Component | State |
|---|---|
| Repo | Cloned locally, all changes pushed to `main` |
| Chat | Working — model `claude-sonnet-4-6`, SDK dependency present |
| Unmapped column UI | Buttons work + free-text custom definition available |
| Ambiguous column UI | Buttons work + free-text custom definition available |
| Session learning | Live — custom definitions persist in `learnedAliases` for session |
| ontology.json | 11 entities, 45 metrics, 5 identifiers (unchanged from Round 4) |
| pos_dictionary.json | Toast 71 maps / Square 50 / Clover 52 (unchanged from Round 4) |
| Cross-session persistence | NOT built — design doc ready (`org_profile_persistence_design.md`) |
| Grain normalization | NOT built — design doc ready (`grain_detection_design.md`) |

---

## Files Changed This Session

| File | Change |
|---|---|
| `app.html` | Free-text input UI, onclick escaping fix, ambiguous UI update, model ID update |
| `api/package.json` | Added `@anthropic-ai/sdk` dependency |

**No changes to:** `api/chat.js`, `api/resolve.js`, `api/lib/resolver.js`, `api/lib/retriever.js`, any Semantic JSON files.

---

## Known Issues / Gaps (priority order, inherited from Round 4)

### 1. Cross-POS row-grain mismatch — HIGHEST VALUE (specced, not built)
Toast = period-aggregated; Square = flat per-payment stream; Clover = ledger needing Order/Line-Item/Employee joins. Mapping columns doesn't fix grain — raw Square/Clover rows must roll up to location-week before KPIs are valid. Full spec: `grain_detection_design.md`.

### 2. Business-date derivation (part of #1)
Only Toast-native. Square/Clover need `timestamp + close-hour`. `business_timestamp` identifier resolves; missing piece is a `business_day_close_hour` calc rule.

### 3. Org-profile persistence (specced, not built)
Session learning is browser-only — gone on refresh. Design ready (`org_profile_persistence_design.md`) but gated on the org_id decision (pilot slug vs. real auth).

### 4. Multi-file schema merging
`chat.js` still uses `schemaList[0]` as primary context. If Sales + Labor uploaded together, only the first gets semantic context.

### 5. Labor-export POS detection returns "generic"
Labor/foodcost files lack sales-signature columns so POS detection falls to generic. Column resolution still works via ontology; only the POS-exact boost is missed.

### 6. Semantic failures are silent
`chat.js` try/catch labels semantic-build errors "non-fatal" and only `console.warn`s. If answers ever ignore the ontology, check Vercel function logs for that warning first.

---

## Next Session Priorities

1. **Build grain detection + roll-up** (`grain_detection_design.md`) — the remaining correctness gap. Add `aggregation` tag per metric (sum/ratio/rate), `business_day_close_hour` calc rule, `normalizeGrain()` between resolve and summarize.
2. **Generate transaction-grain test CSVs** for Square/Clover (one row per payment, raw timestamps, mixed Order Status) to exercise the roll-up.
3. **Org-profile persistence** — first decide org_id strategy, then build Vercel KV + endpoints.
4. **Test full pipeline on a real CSV** — verify noticeably better answers than demo mode on "why is labor high?" / "what's driving food cost?"

---

## Demo Prep Notes (unchanged, still valid)

- "Real restaurant knowledge?" — show `/api/resolve` console output: POS detected, COGS→total_cogs not food_cost, Total Collected flagged as a trap, join-keys recognized.
- "Data protection / Anthropic training?" — commercial API does NOT train on inputs/outputs; ZDR available on request. Privacy claim in UI is accurate.
- "Token costs / scale?" — CSVs summarized before model; selective retrieval ~1,100–1,750 tokens/query, flat as KB grows.
