import { now, run, uid } from '../db.js';

/**
 * Entrega real de e-mail via API HTTP do Resend quando RESEND_API_KEY existe.
 * Sem provedor configurado as mensagens ficam registradas na caixa de saída
 * interna (email_outbox) e o link é entregue apenas ao dono da conta.
 */
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.ZYRA_MAIL_FROM || 'ZYRA CONNECT <no-reply@zyraconnect.app>';

export const MAIL_PROVIDER = RESEND_KEY ? 'resend' : 'outbox';
export const MAIL_CONFIGURED = Boolean(RESEND_KEY);

async function deliver({ to, subject, text, html }) {
  if (!RESEND_KEY) {
    return { delivered: false, provider: 'outbox', error: 'RESEND_API_KEY não configurada' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { delivered: false, provider: 'resend', error: `HTTP ${response.status} ${detail.slice(0, 180)}`.trim() };
    }
    return { delivered: true, provider: 'resend', error: null };
  } catch (error) {
    return { delivered: false, provider: 'resend', error: String(error?.message || error).slice(0, 180) };
  }
}

export async function sendMail({ userId, to, subject, text, html, kind, link }) {
  const id = uid();
  const ts = now();
  run(
    `INSERT INTO email_outbox (id, user_id, to_email, subject, body, kind, link, delivered, provider, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
    id, userId || null, String(to || '').toLowerCase(), subject, text || '', kind || 'generic',
    link || null, MAIL_PROVIDER, ts,
  );
  const result = await deliver({ to, subject, text, html: html || undefined });
  run(
    'UPDATE email_outbox SET delivered = ?, provider = ?, error = ? WHERE id = ?',
    result.delivered ? 1 : 0, result.provider, result.error, id,
  );
  if (!result.delivered) {
    console.warn(`[zyra][mail] mensagem "${subject}" (${kind}) não entregue: ${result.error}`);
  }
  return { id, ...result };
}

export function emailLayout(title, bodyLines, actionLabel, actionUrl) {
  const text = [title, '', ...bodyLines, '', actionLabel ? `${actionLabel}: ${actionUrl}` : '', '', 'ZYRA CONNECT — todos os recursos são gratuitos.']
    .filter((line) => line !== undefined)
    .join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0f1117;color:#e8eaf2;padding:28px;border-radius:16px">
    <h1 style="color:#a78bfa;font-size:20px;margin:0 0 16px">${title}</h1>
    ${bodyLines.map((line) => `<p style="margin:0 0 12px;line-height:1.55">${line}</p>`).join('')}
    ${actionLabel && actionUrl ? `<p style="margin:22px 0"><a href="${actionUrl}" style="background:#7c5cff;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${actionLabel}</a></p>` : ''}
    <p style="color:#8b93a7;font-size:12px;margin-top:24px">ZYRA CONNECT — plataforma gratuita de comunidades.</p>
  </div>`;
  return { text, html };
}
