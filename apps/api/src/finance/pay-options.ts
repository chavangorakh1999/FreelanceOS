import { money, toDecimalString } from '@freelanceos/shared';
import * as QRCode from 'qrcode';

export interface PayOptions {
  /** Free text: bank details and anything else the issuer wrote. */
  instructions: string | null;
  /** upi:// link that opens any UPI app with the payee, amount and invoice number filled in (INR only). */
  upiLink: string | null;
  /** The same link as an SVG QR code, to scan from a phone. */
  upiQrSvg: string | null;
  /** The issuer's payment page with the amount and invoice filled in. */
  payLink: string | null;
}

/**
 * How a client can pay one invoice right now, from the business profile: a UPI link and QR (amount prefilled) for INR,
 * a payment page link with {amount}, {currency} and {invoice} substituted, and the written instructions.
 */
export async function payOptions(ws: { name: string; legalName?: string | null; paymentInstructions: string | null; upiId: string | null; paymentLinkTemplate: string | null },
  inv: { number: string | null; currency: string; outstandingMinor: bigint }): Promise<PayOptions | null> {
  if (inv.outstandingMinor <= 0n) return null;
  const amount = toDecimalString(money(inv.outstandingMinor, inv.currency));
  const ref = inv.number ?? '';
  const upiLink = ws.upiId && inv.currency === 'INR'
    ? `upi://pay?${new URLSearchParams({ pa: ws.upiId, pn: ws.legalName ?? ws.name, am: amount, cu: 'INR', tn: `Invoice ${ref}`.trim() }).toString()}`
    : null;
  const payLink = ws.paymentLinkTemplate
    ? ws.paymentLinkTemplate.replaceAll('{amount}', encodeURIComponent(amount)).replaceAll('{currency}', inv.currency).replaceAll('{invoice}', encodeURIComponent(ref))
    : null;
  if (!ws.paymentInstructions && !upiLink && !payLink) return null;
  return { instructions: ws.paymentInstructions, upiLink, upiQrSvg: upiLink ? await QRCode.toString(upiLink, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null, payLink };
}
