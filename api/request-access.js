import nodemailer from 'nodemailer';

/**
 * "Request access" — lightweight notify-only flow.
 *
 * When someone who isn't Admin/Rmiller wants in, they submit their email here.
 * This emails the OpticAI inbox (GMAIL_USER) so the account can be created
 * manually (by adding/adjusting credentials in env vars). No self-serve
 * approval state machine yet — that's a deliberate v2 deferral.
 *
 * Reuses the same Gmail transport as /api/feedback (GMAIL_USER / GMAIL_APP_PASSWORD).
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, note } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `OpticAI Access Request — ${email}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#13161b;color:#e8eaf0;padding:24px;border-radius:12px;">
          <div style="font-size:22px;font-weight:700;margin-bottom:4px;color:#3b82f6">OpticAI</div>
          <div style="font-size:12px;color:#8b909e;margin-bottom:24px">${timestamp} ET</div>
          <div style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);border-radius:8px;padding:14px 18px;margin-bottom:20px;text-align:center;">
            <div style="font-size:16px;font-weight:600;color:#93c5fd">New access request</div>
          </div>
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;color:#8b909e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Email</div>
            <div style="font-size:14px;"><a href="mailto:${email}" style="color:#93c5fd">${email}</a></div>
          </div>
          ${note ? `<div style="margin-bottom:16px;"><div style="font-size:11px;color:#8b909e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Note</div><div style="font-size:14px;background:#1a1e26;padding:10px 12px;border-radius:6px;line-height:1.55">${note}</div></div>` : ''}
          <div style="font-size:12px;color:#8b909e;line-height:1.6;border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;margin-top:8px">
            To grant access, add this person as a new account (set their username/password
            in Vercel env vars, or extend the accounts list in <code>api/login.js</code>),
            then reply with their credentials.
          </div>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('request-access email error:', err.message);
    return res.status(500).json({ error: 'Failed to send request', detail: err.message });
  }
}
