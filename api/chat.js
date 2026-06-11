const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const client = new Anthropic();

// ---- AUTH (stateless, self-verifying HMAC tokens issued by /api/login) ----
const AUTH_SECRET = process.env.AUTH_SECRET || 'opticai-dev-secret-change-me';

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

// ---- USAGE METERING ----
// Cost estimate, in $ per MILLION tokens. EDIT IF ANTHROPIC PRICING CHANGES.
// Cost in micro-dollars = inputTokens * IN + outputTokens * OUT  (rates below).
const PRICE_PER_MTOK = {
  'claude-sonnet-4-5': { in: 3, out: 15 },
  default:             { in: 3, out: 15 },
};

// ---- BUDGET GUARDRAIL ----
// Tracks cumulative spend against a budget YOU set (the Anthropic API does not
// expose your real account balance to this app). When remaining drops to the
// threshold, emails you ONCE. Re-arm from the admin Usage panel after topping up.
//   API_BUDGET_USD            total budget in dollars (feature is OFF if unset/<=0)
//   API_ALERT_REMAINING_USD   alert threshold, default 1
const API_BUDGET_USD = Number(process.env.API_BUDGET_USD || 0);
const API_ALERT_REMAINING_USD = Number(process.env.API_ALERT_REMAINING_USD || 1);

async function sendBudgetAlert(spentUSD, remainingUSD) {
  try {
    if (!process.env.GMAIL_USER) return;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `OpticAI ⚠️ API budget low — $${remainingUSD.toFixed(2)} remaining`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#13161b;color:#e8eaf0;padding:24px;border-radius:12px;">
          <div style="font-size:22px;font-weight:700;margin-bottom:4px;color:#3b82f6">OpticAI</div>
          <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:14px 18px;margin:16px 0;text-align:center;">
            <div style="font-size:16px;font-weight:600;color:#f59e0b">API budget running low</div>
          </div>
          <div style="font-size:14px;line-height:1.7">
            Estimated spend: <strong>$${spentUSD.toFixed(2)}</strong> of $${API_BUDGET_USD.toFixed(2)} budget.<br>
            Remaining: <strong style="color:#f59e0b">$${remainingUSD.toFixed(2)}</strong>.
          </div>
          <div style="font-size:12px;color:#8b909e;line-height:1.6;border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;margin-top:16px">
            Top up your Anthropic credit, then raise API_BUDGET_USD and click "Re-arm alert"
            in the admin Usage panel to reset this warning.
          </div>
        </div>`,
    });
  } catch (e) {
    console.warn('budget alert email failed (non-fatal):', e.message);
  }
}

async function checkBudget(kv, totalCostMicros) {
  if (!(API_BUDGET_USD > 0)) return; // feature disabled
  const spentUSD = totalCostMicros / 1e6;
  const remainingUSD = API_BUDGET_USD - spentUSD;
  if (remainingUSD > API_ALERT_REMAINING_USD) return; // still above threshold
  // Send only once: NX-set a flag; if it already existed, skip.
  try {
    const firstTime = await kv.set('opticai:budgetAlertSent', '1', { nx: true });
    if (firstTime) await sendBudgetAlert(spentUSD, Math.max(0, remainingUSD));
  } catch (e) {
    console.warn('budget flag check failed (non-fatal):', e.message);
  }
}

async function recordUsage(username, model, usage) {
  // Never let metering break a chat response — swallow all errors.
  try {
    if (!username || !usage) return;
    const inT = Number(usage.input_tokens || 0);
    const outT = Number(usage.output_tokens || 0);
    const rate = PRICE_PER_MTOK[model] || PRICE_PER_MTOK.default;
    const costMicros = Math.round(inT * rate.in + outT * rate.out); // micro-dollars

    let kv;
    try { ({ kv } = await import('@vercel/kv')); }
    catch { console.log(`[usage] ${username} ${model} in=${inT} out=${outT} ~$${(costMicros/1e6).toFixed(4)} (KV not configured)`); return; }

    await kv.sadd('opticai:users', username);
    const key = `opticai:usage:${username}`;
    await kv.hincrby(key, 'calls', 1);
    await kv.hincrby(key, 'inputTokens', inT);
    await kv.hincrby(key, 'outputTokens', outT);
    await kv.hincrby(key, 'costMicros', costMicros);
    await kv.hset(key, { lastSeen: new Date().toISOString() });
    await kv.lpush('opticai:usagelog', JSON.stringify({
      user: username, model, inputTokens: inT, outputTokens: outT,
      costUSD: costMicros / 1e6, ts: new Date().toISOString(),
    }));
    await kv.ltrim('opticai:usagelog', 0, 499);

    // Global running total + budget guardrail.
    const totalMicros = await kv.incrby('opticai:totalCostMicros', costMicros);
    await checkBudget(kv, totalMicros);
  } catch (e) {
    console.warn('recordUsage failed (non-fatal):', e.message);
  }
}

/**
 * Lazy, fully non-fatal loader for the semantic layer.
 *
 * Previously these were top-level `require`s. If ANY of them failed to
 * resolve at runtime (wrong path, missing file, bad JSON), the entire
 * serverless function failed to initialize and every chat request — in
 * both Operational and Financial modes — returned a 500, which the
 * frontend surfaces as "Sorry, I had trouble with that. Try again."
 *
 * By loading them inside a try/catch and degrading gracefully, the core
 * chat call to Anthropic no longer depends on the semantic layer being
 * present. If the semantic files load, we use them; if not, chat still
 * works (just without the extra schema context).
 */
function loadSemanticLayer() {
  try {
    const { buildQueryContext, contextToSystemBlock } = require('./lib/retriever.js');
    return {
      buildQueryContext,
      contextToSystemBlock,
      ontology:    require('./Semantic/ontology.json'),
      calcRules:   require('./Semantic/calc_rules.json'),
      diagnostics: require('./Semantic/diagnostic_graph.json'),
      posDict:     require('./Semantic/pos_dictionary.json'),
    };
  } catch (e) {
    console.warn('Semantic layer unavailable (non-fatal):', e.message);
    return null;
  }
}

/**
 * The frontend embeds two markers into the system prompt string:
 *   __RESOLVED_SCHEMAS__:{json}
 *   __USER_QUESTION__:{text}
 *
 * We extract them here, build the semantic context block, then strip
 * the markers so the model never sees them directly.
 */
function extractSemanticPayload(system) {
  const schemaMatch   = system.match(/__RESOLVED_SCHEMAS__:([\s\S]*?)(?=__USER_QUESTION__|$)/);
  const questionMatch = system.match(/__USER_QUESTION__:([\s\S]*?)$/);

  let schemas  = {};
  let question = '';

  try { if (schemaMatch)   schemas  = JSON.parse(schemaMatch[1].trim());  } catch(e) {}
  try { if (questionMatch) question = questionMatch[1].trim();             } catch(e) {}

  const cleanSystem = system
    .replace(/__RESOLVED_SCHEMAS__:[\s\S]*?(?=__USER_QUESTION__|$)/, '')
    .replace(/__USER_QUESTION__:[\s\S]*$/, '')
    .trim();

  return { schemas, question, cleanSystem };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ---- Require a valid session token (issued by /api/login) ----
  const session = verifyToken(req.headers['x-session-token']);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
    return;
  }

  try {
    const { model, max_tokens, system, messages } = req.body;

    // Pull out the schema payload the frontend embedded
    const { schemas, question, cleanSystem } = extractSemanticPayload(system || '');

    // Build semantic context block if any schemas were resolved AND the
    // semantic layer is available. Any failure here is swallowed so the
    // chat call below always runs.
    let semanticBlock = '';
    const schemaList = Object.values(schemas);
    if (schemaList.length > 0) {
      const sem = loadSemanticLayer();
      if (sem) {
        try {
          const primarySchema = schemaList[0];
          const ctx = sem.buildQueryContext({
            schema: primarySchema,
            question,
            ontology:    sem.ontology,
            calcRules:   sem.calcRules,
            diagnostics: sem.diagnostics,
            posDict:     sem.posDict,
            orgProfile:  null   // no org profile in v1
          });
          semanticBlock = '\n\n' + sem.contextToSystemBlock(ctx);
        } catch (e) {
          console.warn('Semantic context build failed (non-fatal):', e.message);
        }
      }
    }

    const finalSystem = cleanSystem + semanticBlock;

    const response = await client.messages.create({
      model,
      max_tokens,
      system: [{ type: "text", text: finalSystem, cache_control: { type: "ephemeral" } }],
      messages,
      headers: { "anthropic-beta": "prompt-caching-2024-07-31" }
    });

    // Meter this call against the signed-in user (non-blocking on failure).
    await recordUsage(session.u, model, response.usage);

    res.json(response);

  } catch (err) {
    // Log the real reason server-side; return it so the frontend/devtools
    // can show something more useful than the generic fallback.
    console.error('chat error:', err);
    res.status(500).json({ error: err.message || 'chat handler failed' });
  }
};
