'use client';

import { Eraser, ImageUp, PenLine, Type } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type SignatureValue = { kind: 'TYPED' } | { kind: 'DRAWN' | 'UPLOADED'; image: string };
type Mode = SignatureValue['kind'];

const MODES: [Mode, string, typeof Type][] = [['TYPED', 'Type', Type], ['DRAWN', 'Draw', PenLine], ['UPLOADED', 'Upload', ImageUp]];
const MAX_UPLOAD = 500 * 1024;

/**
 * Three ways to sign: the typed name itself, a signature drawn with a finger, mouse or pen, or an image of a signature.
 * Reports `null` until the chosen way is complete (something drawn, an image picked), so the caller can disable Sign.
 */
export function SignaturePad({ name, onChange }: { name: string; onChange: (v: SignatureValue | null) => void }) {
  const [mode, setMode] = useState<Mode>('TYPED');
  const [upload, setUpload] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const choose = (m: Mode) => {
    setMode(m);
    if (m === 'TYPED') onChange({ kind: 'TYPED' });
    else if (m === 'UPLOADED') onChange(upload ? { kind: 'UPLOADED', image: upload } : null);
    else onChange(drawn && canvas.current ? { kind: 'DRAWN', image: trimmed(canvas.current) } : null);
  };
  useEffect(() => { onChange({ kind: 'TYPED' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the canvas backing store to its displayed size, so strokes stay crisp on high-density screens.
  useEffect(() => {
    const c = canvas.current;
    if (mode !== 'DRAWN' || !c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1d1b19';
    setDrawn(false);
  }, [mode]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const g = e.currentTarget.getContext('2d')!; const [x, y] = at(e);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const g = e.currentTarget.getContext('2d')!; const [x, y] = at(e);
    g.lineTo(x, y); g.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; setDrawn(true);
    onChange({ kind: 'DRAWN', image: trimmed(canvas.current!) });
  };
  const clear = () => {
    const c = canvas.current; if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setDrawn(false); onChange(null);
  };
  const pick = (f: File | undefined) => {
    setUploadError(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type)) { setUploadError('Choose a PNG or JPEG image.'); return; }
    if (f.size > MAX_UPLOAD) { setUploadError('That image is over 500 KB. Crop it or save it smaller.'); return; }
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); setUpload(url); onChange({ kind: 'UPLOADED', image: url }); };
    r.readAsDataURL(f);
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="How to sign" className="inline-flex w-fit rounded-control border border-line bg-paper-2 p-0.5">
        {MODES.map(([m, label, Icon]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => choose(m)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium ${mode === m ? 'bg-card text-ink shadow-card' : 'text-muted hover:text-ink'}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />{label}
          </button>))}
      </div>
      <div className="relative h-36 overflow-hidden rounded-control border border-dashed border-line-strong bg-card">
        {mode === 'TYPED' && (
          <div className="flex h-full items-center justify-center px-4">
            <span className="truncate font-serif text-3xl italic text-ink" aria-live="polite">{name.trim() || <span className="text-base not-italic text-muted">Your typed name appears here</span>}</span>
          </div>)}
        {mode === 'DRAWN' && (<>
          <canvas ref={canvas} aria-label="Draw your signature here" className="h-full w-full cursor-crosshair touch-none"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
          {!drawn && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">Sign here with your mouse, finger or pen</span>}
          {drawn && <button type="button" onClick={clear} className="absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-[6px] bg-paper-3 px-2 text-xs text-ink-2 hover:text-ink"><Eraser className="h-3.5 w-3.5" aria-hidden />Clear</button>}
        </>)}
        {mode === 'UPLOADED' && (
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1 px-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {upload ? <img src={upload} alt="Your signature" className="max-h-28 max-w-full object-contain" /> : <><ImageUp className="h-5 w-5 text-muted" aria-hidden /><span className="text-sm text-ink-2">Choose an image of your signature</span><span className="text-xs text-muted">PNG or JPEG, up to 500 KB</span></>}
            <input type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Signature image" onChange={(e) => pick(e.target.files?.[0])} />
          </label>)}
        {!(mode === 'UPLOADED' && upload) && <span aria-hidden className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-line" />}
      </div>
      {uploadError && <p role="alert" className="text-xs text-danger">{uploadError}</p>}
      {mode === 'UPLOADED' && upload && <button type="button" className="w-fit text-xs text-muted underline hover:text-ink" onClick={() => { setUpload(null); onChange(null); }}>Choose a different image</button>}
    </div>
  );
}

/** The drawing cropped to its ink plus a small margin, so it sits at a readable size on the agreement and PDF. */
function trimmed(c: HTMLCanvasElement): string {
  const g = c.getContext('2d')!;
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c.toDataURL('image/png');
  const pad = 8;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
