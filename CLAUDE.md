# OpticAI — Claude Code Instructions

## Project overview
Multi-tenant restaurant intelligence dashboard. Serverless Vercel app. No build step.
Frontend: app.html, index.html. API layer: /api folder (CommonJS).
Semantic config: /semantic folder (ontology.json, calc_rules.json, pos_dictionary.json).

## Key rules
- Demo/sample data must always be labeled with "(sample)" suffix — never present as real
- Financial parser reads report type, entity, and period from internal document labels, not filenames
- Do not mix operational and financial data — separate ontology, separate upload flows, separate system prompts
- Free-tier-first: evaluate all infrastructure against free tier limits before recommending paid options
- Server-side token validation required on ALL /api endpoints — client-side auth does not protect API spend

## Git workflow
- Always show me the diff before committing
- Never push without my explicit confirmation
- Commit messages should be descriptive and scoped (e.g. "financial: add trailing-13 EBITDA chart")

## Test command
None configured yet — flag if a change warrants adding one.
