import { esc } from '../../documents/html';

/**
 * Emails are deliberately thin: a short, non-confidential sentence and a link. Anything sensitive (amounts, scope text,
 * comments) stays behind sign-in, so an email forwarded or read by the wrong person reveals nothing (PRD §7.13).
 */
export function renderEmail(m: { subject: string; bodyText: string; linkPath: string; origin: string; businessName?: string }) {
  const link = `${m.origin.replace(/\/$/, '')}${m.linkPath}`;
  const text = `${m.bodyText}\n\nOpen it here (sign-in required):\n${link}\n\n${m.businessName ? `Sent by ${m.businessName} using FreelanceOS. ` : ''}You can change which emails you receive in your account settings.`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#121212;max-width:520px;margin:0 auto;padding:24px">
<p style="margin:0 0 16px">${esc(m.bodyText).replace(/\n/g, '<br>')}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">Open it</a></p>
<p style="margin:0;color:#5f5f5f;font-size:13px">Sign-in is required to view the details.${m.businessName ? ` Sent by ${esc(m.businessName)} using FreelanceOS.` : ''} You can change which emails you receive in your account settings.</p>
</body></html>`;
  return { subject: m.subject, text, html };
}
