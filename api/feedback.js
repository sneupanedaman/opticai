const nodemailer = require('nodemailer');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sentiment, email, note, source, dataUploaded } = req.body;

  try {
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    const sentimentLabel = sentiment === 'up' ? '👍 VALUABLE' : '👎 NOT FOR ME';
    const sentimentColor = sentiment === 'up' ? '#10b981' : '#ef4444';
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `OpticAI Feedback: ${sentimentLabel} ${email ? '— ' + email : '(anonymous)'}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#13161b;color:#e8eaf0;padding:24px;border-radius:12px;">
          <div style="font-size:22px;font-weight:700;margin-bottom:4px;color:#3b82f6">OpticAI</div>
          <div style="font-size:12px;color:#555b6a;margin-bottom:24px">${timestamp} ET</div>

          <div style="background:${sentimentColor}20;border:1px solid ${sentimentColor}40;border-radius:8px;padding:14px 18px;margin-bottom:20px;text-align:center;">
            <div style="font-size:28px;margin-bottom:4px">${sentiment === 'up' ? '👍' : '👎'}</div>
            <div style="font-size:16px;font-weight:600;color:${sentimentColor}">${sentimentLabel}</div>
          </div>

          ${email ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;color:#555b6a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Email</div>
            <div style="font-size:14px;color:#93c5fd"><a href="mailto:${email}" style="color:#93c5fd">${email}</a></div>
          </div>` : '<div style="margin-bottom:16px;font-size:13px;color:#555b6a;font-style:italic">No email provided (anonymous)</div>'}

          ${note ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;color:#555b6a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Their note</div>
            <div style="font-size:14px;color:#e8eaf0;background:#1a1e26;padding:10px 12px;border-radius:6px;line-height:1.55">${note}</div>
          </div>` : ''}

          <div style="margin-bottom:8px;">
            <div style="font-size:11px;color:#555b6a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Data uploaded</div>
            <div style="font-size:13px;color:#8b909e">${dataUploaded || 'Demo data only'}</div>
          </div>

          <div>
            <div style="font-size:11px;color:#555b6a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Triggered by</div>
            <div style="font-size:13px;color:#8b909e">${source || 'Unknown'}</div>
          </div>
        </div>
      `
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send', detail: err.message });
  }
}
