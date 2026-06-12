# OpticAI — Visual Redesign Handoff (for Claude Code)

## Context
OpticAI is a working restaurant-analytics app (Operational + Financial tabs, CSV/XLSX upload,
AI analyst, schema resolver). **None of that logic changes.** This is a **visual-system reskin**
to remove the generic "AI-built" look. The reference implementation is the file
`OpticAI-Redesign.html` (Financial tab, fully styled) — treat its tokens, type, and components as
the source of truth. Apply the *same* system to **both** tabs.

**Do NOT touch:** data parsing, `summarizeData`, schema/resolve calls, chart *data*, auth, upload
flow logic, API calls. Only change CSS, markup classes, the chart *style options*, icon rendering,
and the AI-message *renderer*.

---

## 1. Design tokens — replace the entire `:root` block

The old palette is the literal Tailwind default swatch (`#3b82f6 / #10b981 / #ef4444 / #f59e0b /
#8b5cf6`) — that is the #1 reason it reads as AI-generated. Replace with this warm, institutional
system. Add a `[data-theme]` attribute on `<body>` and support both.

```css
:root {                       /* LIGHT (default) */
  --canvas:#F4F1EA; --surface:#FCFBF7; --surface-2:#F0EDE4;
  --ink:#20201C; --ink-soft:#6A655B; --ink-faint:#9C968A;
  --line:#E2DDD1; --line-strong:#D2CCBD;
  --brand:#235C45; --brand-ink:#18402F; --brand-soft:#E5EDE7;   /* deep evergreen */
  --clay:#B6603C; --clay-soft:#F3E6DD;                          /* terracotta */
  --pos:#2C7A57; --neg:#A8442C; --warn:#9C6B16; --warn-soft:#F4EAD3;
  --c1:#235C45; --c2:#B6603C; --c3:#C99A3A; --c4:#5E8C84; --c5:#8A5A6B; /* chart series */
}
[data-theme="dark"] {         /* warm charcoal — NOT navy */
  --canvas:#14130F; --surface:#1C1A15; --surface-2:#211E18;
  --ink:#EFEBE0; --ink-soft:#A39C8C; --ink-faint:#6F695C;
  --line:#2C2820; --line-strong:#3A352B;
  --brand:#5FA383; --brand-ink:#7DB89C; --brand-soft:#1E2C24;
  --clay:#D08359; --clay-soft:#2E241D;
  --pos:#5FA383; --neg:#D07A5E; --warn:#C99A3A; --warn-soft:#2A2415;
  --c1:#5FA383; --c2:#D08359; --c3:#D8B45A; --c4:#7FB0A6; --c5:#B07E8F;
}
```

**Rule:** never hardcode a hex anywhere else. Every color = a `var(--token)`. Semantic mapping:
positive/good = `--pos`, over-target/bad = `--neg`, caution = `--warn`. The chart categorical
series ALWAYS come from `--c1..--c5` in order (kills the rainbow-Tailwind look).

---

## 2. Typography — drop DM Sans/Mono

```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```
- UI / body: **Hanken Grotesk**. Set `font-variant-numeric: tabular-nums` on `body`.
- All numeric values (KPI figures, $ amounts, %, dates, the sidebar entity totals): wrap in
  `class="num"` → `font-family:'IBM Plex Mono'; letter-spacing:-0.02em;`. Tabular figures stop
  numbers from jittering.

---

## 3. KPI band — build hierarchy (currently 5 equal cards)

Replace the 5 identical `.kpi-card`s with **one bordered band** containing a **hero tile + 4
supporting tiles**, dividers between (not gaps):

- Wrap in one rounded container: `background:--surface; border:1px solid --line; border-radius:12px;
  overflow:hidden`. Tiles separated by `border-right:1px solid --line`.
- **Hero tile** (first, e.g. Total Sales): `background:--brand; color:#fff`, value at 34px, plus a
  tiny inline sparkline canvas (top-right, 56×22, white 1.5px line).
- Supporting tiles: value 30px, label 11.5px `--ink-soft`, sub-line uses `--pos/--neg/--warn` with
  a small inline icon. Grid: `grid-template-columns:1.5fr 1fr 1fr 1fr 1fr`.
- **Delete every per-card "Demo" tag.** Data-source status lives in ONE ribbon (next section).
- See `.kpi-band / .kpi / .kpi.hero` in the reference file for exact CSS.

---

## 4. One status ribbon — remove the scattered "Demo" badges

Single calm strip above the KPI band:
```
[flask icon]  Showing sample data — figures are illustrative until you connect your own statements.
                                                        Upload P&L / Balance Sheet →
```
Style with `--warn-soft` bg + `--warn` text/border (see `.ribbon`). Three states reusing tokens:
sample → `--warn`, mixed → `--brand`, all-live → `--pos`. Drop the per-chart "demo/sample" captions
too, or shrink them to a single uppercase `.panel-meta` tag in the corner.

---

## 5. Charts — restyle options only (keep the data)

Set globally once: `Chart.defaults.font.family = "'Hanken Grotesk',sans-serif"`. For every chart:
- Series colors come from `--c1..--c5` (read via `getComputedStyle`), never literal hex.
- Gridlines: light `rgba(40,36,28,.07)` (or `rgba(255,255,255,.06)` in dark); `border.display:false`,
  `drawTicks:false`, tick color `--ink-faint`, tick padding 8.
- Bars: `borderRadius:4`, sensible `barThickness`. Doughnut: `cutout:'66%'`,
  `borderColor:--surface`, `borderWidth:3`, legend `usePointStyle` rounded.
- **Rebuild charts on theme/accent change** so they re-read the CSS vars.

### 5a. Operational "spaghetti" charts (Weekly sales + Labor% by location)
These 5-line charts are the noisiest screens. Keep the data, add focus-on-demand:
- Default: draw each line in `--c1..--c5` but at ~30–40% opacity, `borderWidth:1.5`, `pointRadius:0`.
- On legend hover/click OR sidebar location select: bring that location's line to full opacity +
  `borderWidth:2.5`, fade the rest to ~12%. This makes a wall of lines legible and feels intentional.
- The sidebar **Locations** list and the chart legend should drive the same highlight state.

---

## 6. AI Analyst panel — fix the biggest tell

The briefing currently prints literal markdown (`**ACTION ITEMS**`) and uses emoji. Both scream
"LLM output nobody styled."
- **Render markdown** in AI messages: `**bold**` → `<strong>`, `## / ALL-CAPS headers` → styled
  `<h4>` (11px, uppercase, letterspaced, `--ink-faint`), numbered lists → custom counter chips
  (mono number in a `--brand-soft` rounded square). See `.bubble h4 / .bubble ol li::before`.
- Highlight dollar/percent impact phrases in `--brand` bold (`.impact`).
- **Remove ALL emoji** from the UI: 👍👎 in feedback, ⚠️✓🆕 in chat, the `● Live` dot — replace with
  the icon set below (a small colored `.dot` for status, inline SVG check/alert for messages).
- User bubble: `--brand` bg, white, `border-radius:12px 12px 3px 12px`. AI bubble: plain on surface,
  no bordered box.

---

## 7. Icons — replace the Tabler webfont

(The font CDN is also flaky in some sandboxes.) Use a small **inline-SVG set** keyed by name —
copy the `ICONS` map + the `[data-ic]` renderer from the bottom of the reference file. Markup
becomes `<i data-ic="upload"></i>`; CSS `[data-ic] svg{width:1em;height:1em}` so existing
`font-size` rules still size them. Icons used: bar-chart, activity, receipt, upload, calendar,
download, sliders, flask, trending-up, arrow-up-right, check, sparkles, eraser, file-text, mic,
send. **No emoji as UI anywhere.**

---

## 8. Appearance control (nice-to-have)
A small popover (gear/sliders button in the topbar) with **Theme** (Light/Dark) and **Accent**
(evergreen / oxblood `#7A3E2E` / ink-blue `#2A4A6B` / aubergine `#5B4A86`). Setting `--brand` +
deriving `--brand-ink/--brand-soft/--c1`, then rebuilding charts. Persist choice to `localStorage`.

---

## Acceptance checklist
- [ ] No Tailwind-default hexes remain; all color via `var(--token)`; light + dark both work.
- [ ] Hanken Grotesk + IBM Plex Mono (tabular) loaded; DM Sans/Mono gone.
- [ ] KPI band has one hero tile + supporting tiles; no per-card Demo tags.
- [ ] Exactly one data-source ribbon; chart captions reduced to a single corner tag.
- [ ] Chart series use `--c1..--c5`; spaghetti charts have hover/select focus behavior.
- [ ] AI messages render real bold/headers/numbered chips; ZERO emoji in the app.
- [ ] Icons are inline SVG; nothing depends on the Tabler webfont.
- [ ] **Operational and Financial are visually identical in system** — only content differs.
- [ ] No change to data, parsing, schema, auth, or API behavior.
