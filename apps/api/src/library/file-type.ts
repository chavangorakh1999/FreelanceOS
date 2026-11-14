/**
 * Decide what a file really is from its bytes, not from the name or the browser's claim (PRD §7.11 "validate file
 * type"). Only formats a freelancer actually exchanges are accepted; anything executable or unknown is refused.
 */
export interface Sniffed { mimeType: string; extension: string }

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const TEXT: Record<string, string> = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown' };

const starts = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function sniff(bytes: Buffer, fileName: string): Sniffed | null {
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mimeType: 'application/pdf', extension: 'pdf' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: 'image/png', extension: 'png' };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { mimeType: 'image/webp', extension: 'webp' };
  // Office files are ZIP containers: accept them only under their own extension, never an arbitrary archive.
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && OFFICE[ext] && bytes.includes(Buffer.from('[Content_Types].xml'))) return { mimeType: OFFICE[ext], extension: ext };
  if (TEXT[ext] && isText(bytes)) return { mimeType: TEXT[ext], extension: ext };
  return null;
}

function isText(b: Buffer): boolean {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.length === b.length ? head : head.subarray(0, head.length - 4)); return true; } catch { return false; }
}

/** A name safe to put in a Content-Disposition header and to show: no paths, no control characters, bounded length. */
export function safeFileName(name: string, extension: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 120) || 'file';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base.replace(/\.[^.]*$/, '')}.${extension}`;
}
