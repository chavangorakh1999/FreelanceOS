export const CURRENCIES: [string, string][] = [['USD', 'US dollar'], ['INR', 'Indian rupee'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['AED', 'UAE dirham'], ['AUD', 'Australian dollar'], ['CAD', 'Canadian dollar'], ['SGD', 'Singapore dollar'], ['JPY', 'Japanese yen'], ['KWD', 'Kuwaiti dinar']];
/** A sensible first guess from the browser's time zone; the person can change it. */
export function guessCurrency(tz: string) {
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'INR';
  if (tz.startsWith('Europe/London')) return 'GBP';
  if (tz.startsWith('Europe/')) return 'EUR';
  if (tz === 'Asia/Dubai') return 'AED';
  if (tz === 'Asia/Singapore') return 'SGD';
  if (tz === 'Asia/Tokyo') return 'JPY';
  if (tz === 'Asia/Kuwait') return 'KWD';
  if (tz.startsWith('Australia/')) return 'AUD';
  if (tz === 'America/Toronto' || tz === 'America/Vancouver') return 'CAD';
  return 'USD';
}

