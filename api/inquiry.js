const TO = process.env.INQUIRY_TO || 'hekmat.h@div3rsa.com';
const FROM = process.env.INQUIRY_FROM || 'Trafexa Website <onboarding@resend.dev>';

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function text(value='') { return String(value).trim(); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: 'Email service is not configured.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.website) return res.status(200).json({ ok: true });

  const required = ['name','company','email','country','buyerType','brand','model','destination'];
  for (const key of required) {
    if (!text(body[key])) return res.status(400).json({ error: `Missing field: ${key}` });
  }
  if (!body.consent) return res.status(400).json({ error: 'Consent is required.' });
  if (!/^\S+@\S+\.\S+$/.test(text(body.email))) return res.status(400).json({ error: 'Invalid email address.' });

  const subject = `Trafexa request — ${text(body.brand)} ${text(body.model)} — ${text(body.company)}`;
  const fields = [
    ['Name', body.name], ['Company', body.company], ['Email', body.email], ['Phone / WhatsApp', body.phone],
    ['Buyer location', body.country], ['Buyer type', body.buyerType], ['Brand', body.brand], ['Model', body.model],
    ['Model year', body.year], ['Quantity', body.quantity], ['Condition', body.condition], ['Target budget', body.budget],
    ['Destination', body.destination], ['Specification / notes', body.notes]
  ];
  const rows = fields.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#777;vertical-align:top;border-bottom:1px solid #eee">${esc(label)}</td><td style="padding:8px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #eee;white-space:pre-wrap">${esc(value || '—')}</td></tr>`).join('');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: text(body.email),
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto"><h2>New Trafexa vehicle request</h2><p>A new sourcing request was submitted on trafexa.com.</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="margin-top:24px;color:#777;font-size:12px">Submitted via Trafexa, operated by Diversa Nordic AB.</p></div>`
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) return res.status(502).json({ error: 'Email provider rejected the request.', detail: result });
  return res.status(200).json({ ok: true });
}
