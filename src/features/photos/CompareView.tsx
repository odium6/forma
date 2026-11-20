import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { PhotoCategory, PhotoMeta } from '@/domain/types';
import { diffDays, formatDate } from '@/lib/dates';
import { nDays } from '@/lib/format';
import { Sheet } from '@/ui/Sheet';
import { Segmented } from '@/ui/controls';
import { Slider } from 'glisse';
import { PhotoThumb, usePhotoURL } from './PhotoThumb';

const CAT: Record<PhotoCategory, string> = { front: 'Спереди', side: 'Сбоку', back: 'Сзади', other: 'Другое' };

interface Align {
  zoom: number;
  x: number;
  y: number;
}

/**
 * Before/after comparison. Both images share one frame and object-fit, so scale is
 * consistent; per-photo zoom/offset only changes the view, never the stored originals.
 */
export function CompareView({ photos, onClose }: { photos: PhotoMeta[]; onClose: () => void }) {
  const cats = (Object.keys(CAT) as PhotoCategory[]).filter((c) => photos.filter((p) => p.category === c).length >= 1);
  const [cat, setCat] = useState<PhotoCategory | 'all'>(cats.find((c) => photos.filter((p) => p.category === c).length >= 2) ?? 'all');
  const pool = useMemo(() => [...photos].filter((p) => cat === 'all' || p.category === cat).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt), [photos, cat]);
  const [aId, setA] = useState<string | null>(null);
  const [bId, setB] = useState<string | null>(null);
  const a = pool.find((p) => p.id === aId) ?? pool[0] ?? null;
  const b = pool.find((p) => p.id === bId) ?? pool[pool.length - 1] ?? null;
  const [mode, setMode] = useState<'slider' | 'side'>('slider');
  const [pos, setPos] = useState(50);
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const [alignA, setAlignA] = useState<Align>({ zoom: 1, x: 0, y: 0 });
  const [alignB, setAlignB] = useState<Align>({ zoom: 1, x: 0, y: 0 });
  const [adjust, setAdjust] = useState<'a' | 'b' | null>(null);
  const urlA = usePhotoURL(a?.id ?? null, 'blob');
  const urlB = usePhotoURL(b?.id ?? null, 'blob');
  const frame = useRef<HTMLDivElement>(null);

  const style = (al: Align) => ({ transform: `translate(${al.x}%, ${al.y}%) scale(${al.zoom})` });
  const dragSlider = (e: RPointerEvent<HTMLDivElement>) => {
    if (mode !== 'slider' || adjust || !(e.buttons & 1) || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };
  const current = adjust === 'a' ? alignA : alignB;
  const setCurrent = adjust === 'a' ? setAlignA : setAlignB;

  return (
    <Sheet open onClose={onClose} title="Сравнение" size="full">
      <div className="row wrap between">
        <Segmented label="Ракурс" value={cat} onChange={(v) => { setCat(v); setA(null); setB(null); }} items={[{ value: 'all', label: 'Все' }, ...cats.map((c) => ({ value: c, label: CAT[c] }))]} />
        <Segmented label="Вид" value={mode} onChange={setMode} items={[{ value: 'slider', label: 'Ползунок' }, { value: 'side', label: 'Рядом' }]} />
      </div>
      {!a || !b || a.id === b.id ? (
        <p className="muted small">Для сравнения нужно минимум два фото выбранного ракурса.</p>
      ) : (
        <>
          <div className="cmp-meta row between small">
            <button className="chip" onClick={() => setPicking('a')}>До: {formatDate(a.date)}</button>
            <span className="muted">{nDays(Math.abs(diffDays(b.date, a.date)))}</span>
            <button className="chip" onClick={() => setPicking('b')}>После: {formatDate(b.date)}</button>
          </div>
          {mode === 'slider' ? (
            <div className="cmp-frame" ref={frame} onPointerDown={dragSlider} onPointerMove={dragSlider} data-testid="compare-slider-frame">
              {urlA && <img src={urlA} alt="До" style={style(alignA)} draggable={false} />}
              <div className="cmp-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
                {urlB && <img src={urlB} alt="После" style={style(alignB)} draggable={false} />}
              </div>
              <div className="cmp-handle" style={{ left: `${pos}%` }} aria-hidden="true"><span /></div>
              <span className="cmp-label l">До</span>
              <span className="cmp-label r">После</span>
            </div>
          ) : (
            <div className="cmp-side">
              <div className="cmp-frame">{urlA && <img src={urlA} alt="До" style={style(alignA)} draggable={false} />}<span className="cmp-label l">{formatDate(a.date)}</span></div>
              <div className="cmp-frame">{urlB && <img src={urlB} alt="После" style={style(alignB)} draggable={false} />}<span className="cmp-label l">{formatDate(b.date)}</span></div>
            </div>
          )}
          {mode === 'slider' && (
            <Slider aria-label="Положение разделителя" min={0} max={100} step={1} value={pos} onValueChange={setPos} />
          )}
          <div className="row wrap">
            <span className="small muted">Выравнивание:</span>
            <button className={`chip ${adjust === 'a' ? 'on' : ''}`} onClick={() => setAdjust(adjust === 'a' ? null : 'a')}>Фото «до»</button>
            <button className={`chip ${adjust === 'b' ? 'on' : ''}`} onClick={() => setAdjust(adjust === 'b' ? null : 'b')}>Фото «после»</button>
            <button className="chip" onClick={() => { setAlignA({ zoom: 1, x: 0, y: 0 }); setAlignB({ zoom: 1, x: 0, y: 0 }); }}>Сбросить</button>
          </div>
          {adjust && (
            <div className="align-grid">
              <label className="small muted">Масштаб<Slider aria-label="Масштаб" min={0.6} max={2} step={0.01} value={current.zoom} onValueChange={(v) => setCurrent({ ...current, zoom: v })} /></label>
              <label className="small muted">По горизонтали<Slider aria-label="Сдвиг по горизонтали" min={-30} max={30} step={0.5} value={current.x} onValueChange={(v) => setCurrent({ ...current, x: v })} /></label>
              <label className="small muted">По вертикали<Slider aria-label="Сдвиг по вертикали" min={-30} max={30} step={0.5} value={current.y} onValueChange={(v) => setCurrent({ ...current, y: v })} /></label>
            </div>
          )}
        </>
      )}
      {picking && (
        <div className="pick">
          <div className="small strong">Выбери фото «{picking === 'a' ? 'до' : 'после'}»</div>
          <div className="photo-grid">
            {pool.map((p) => (
              <PhotoThumb
                key={p.id}
                photo={p}
                selected={(picking === 'a' ? a : b)?.id === p.id}
                label={`${CAT[p.category]}, ${formatDate(p.date)}`}
                onClick={() => {
                  if (picking === 'a') setA(p.id);
                  else setB(p.id);
                  setPicking(null);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
