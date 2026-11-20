import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/app/Layout';
import { LockScreen, useLock } from '@/app/lock';
import type { PhotoCategory, PhotoMeta } from '@/domain/types';
import { addPhoto, deletePhoto, updatePhotoMeta, useData } from '@/state/store';
import { formatDate, today } from '@/lib/dates';
import { captureFrame, preparePhoto, type PreparedPhoto } from '@/lib/images';
import { EmptyState, Segmented, Notice } from '@/ui/controls';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';
import { PhotoThumb, usePhotoURL } from './PhotoThumb';
import { CompareView } from './CompareView';
import './photos.css';

export const CATEGORY_LABELS: Record<PhotoCategory, string> = { front: 'Спереди', side: 'Сбоку', back: 'Сзади', other: 'Другое' };
type Filter = PhotoCategory | 'all';

export default function PhotosPage() {
  const data = useData();
  const { locked, hasPin } = useLock();
  const [filter, setFilter] = useState<Filter>('all');
  const [order, setOrder] = useState<'new' | 'old'>('new');
  const [pending, setPending] = useState<PreparedPhoto[] | null>(null);
  const [camera, setCamera] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();

  if (hasPin && locked && data.settings.lockScope === 'photos') {
    return (
      <div className="page">
        <PageHeader title="Фото" />
        <LockScreen scope="photos" />
      </div>
    );
  }

  const list = data.photos.filter((p) => filter === 'all' || p.category === filter);
  const sorted = order === 'new' ? list : [...list].reverse();
  const groups = new Map<string, PhotoMeta[]>();
  for (const p of sorted) groups.set(p.date, [...(groups.get(p.date) ?? []), p]);
  const viewing = data.photos.find((p) => p.id === viewer) ?? null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const out: PreparedPhoto[] = [];
    for (const f of [...files].slice(0, 12)) {
      try {
        out.push(await preparePhoto(f));
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, { tone: 'error' });
      }
    }
    if (out.length) setPending(out);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="page">
      <PageHeader
        title="Фото"
        subtitle="Хранятся только на этом устройстве"
        actions={
          <>
            {data.photos.length >= 2 && (
              <button className="btn" onClick={() => setCompare(true)} data-testid="compare-open">
                <Icon name="compare" size={18} /> <span className="hide-xs">Сравнить</span>
              </button>
            )}
            <button className="btn primary" onClick={() => fileRef.current?.click()} data-testid="photo-add">
              <Icon name="plus" size={18} /> <span className="hide-xs">Добавить</span>
            </button>
          </>
        }
      />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => onFiles(e.target.files)} data-testid="photo-input" />
      <div className="row wrap between">
        <Segmented
          label="Ракурс"
          value={filter}
          onChange={setFilter}
          items={[{ value: 'all', label: 'Все' }, ...(Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
        />
        <div className="row">
          <button className="btn sm ghost" onClick={() => setOrder(order === 'new' ? 'old' : 'new')} aria-label="Порядок сортировки">
            <Icon name={order === 'new' ? 'arrowDown' : 'arrowUp'} size={16} /> {order === 'new' ? 'Сначала новые' : 'Сначала старые'}
          </button>
          <button className="btn sm" onClick={() => setCamera(true)}>
            <Icon name="camera" size={16} /> Камера
          </button>
        </div>
      </div>
      {data.photos.length === 0 ? (
        <section className="card">
          <EmptyState
            icon="camera"
            title="Фото прогресса"
            text="Снимай в одном месте, при одинаковом свете и в одной позе — так изменения будут заметнее. Фото не покидают устройство."
            action={
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => fileRef.current?.click()}>Загрузить</button>
                <button className="btn" onClick={() => setCamera(true)}>Снять</button>
              </div>
            }
          />
        </section>
      ) : sorted.length === 0 ? (
        <p className="muted small">Нет фото в этой категории.</p>
      ) : (
        [...groups.entries()].map(([date, ps]) => (
          <section key={date} className="photo-group">
            <h3 className="small muted">{formatDate(date, { weekday: true })}</h3>
            <div className="photo-grid">
              {ps.map((p) => (
                <div key={p.id} className="photo-cell">
                  <PhotoThumb photo={p} onClick={() => setViewer(p.id)} label={`${CATEGORY_LABELS[p.category]}, ${formatDate(p.date)}`} />
                  <span className="photo-tag">{CATEGORY_LABELS[p.category]}</span>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      {!hasPin && data.photos.length > 0 && (
        <Notice icon="lock">Можно защитить раздел PIN-кодом или биометрией в настройках приватности.</Notice>
      )}
      {pending && <SaveSheet photos={pending} onClose={() => setPending(null)} />}
      {camera && (
        <CameraSheet
          onClose={() => setCamera(false)}
          onCaptured={(p) => {
            setCamera(false);
            setPending([p]);
          }}
          onFallback={() => {
            setCamera(false);
            fileRef.current?.click();
          }}
        />
      )}
      {viewing && <Viewer photo={viewing} onClose={() => setViewer(null)} />}
      {compare && <CompareView photos={data.photos} onClose={() => setCompare(false)} />}
    </div>
  );
}

function SaveSheet({ photos, onClose }: { photos: PreparedPhoto[]; onClose: () => void }) {
  const { toast } = useFeedback();
  const [date, setDate] = useState(today());
  const [cats, setCats] = useState<PhotoCategory[]>(() => photos.map((_, i) => (['front', 'side', 'back'] as const)[i] ?? 'other'));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const urls = useMemo(() => photos.map((p) => URL.createObjectURL(p.thumb)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const save = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        await addPhoto({ date, category: cats[i], note: note.trim().slice(0, 500), width: p.width, height: p.height, mime: p.mime, size: p.blob.size }, p.blob, p.thumb);
      }
      toast(photos.length > 1 ? `Сохранено фото: ${photos.length}` : 'Фото сохранено', { tone: 'success' });
      onClose();
    } catch (e) {
      console.error(e);
      toast('Не хватает места в хранилище браузера или доступ запрещён', { tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={photos.length > 1 ? `Новые фото (${photos.length})` : 'Новое фото'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy || date > today()} onClick={save} data-testid="photo-save">Сохранить</button>
        </>
      }
    >
      <div className="pending-list">
        {photos.map((_, i) => (
          <div key={i} className="pending">
            <img src={urls[i]} alt="" />
            <select className="input" aria-label="Ракурс" value={cats[i]} onChange={(e) => setCats((c) => c.map((x, j) => (j === i ? (e.target.value as PhotoCategory) : x)))}>
              {(Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="ph-date">Дата</label>
        <input id="ph-date" className="input" type="date" max={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ph-note">Заметка</label>
        <input id="ph-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: утро, после сна" />
      </div>
      <p className="xs faint">Оригинал сохраняется без изменений (включая метаданные файла) только в хранилище этого браузера.</p>
    </Sheet>
  );
}

function Viewer({ photo, onClose }: { photo: PhotoMeta; onClose: () => void }) {
  const url = usePhotoURL(photo.id, 'blob');
  const { confirm, toast } = useFeedback();
  const [note, setNote] = useState(photo.note);
  const [cat, setCat] = useState(photo.category);
  const [date, setDate] = useState(photo.date);
  const dirty = note !== photo.note || cat !== photo.category || date !== photo.date;
  return (
    <Sheet
      open
      onClose={onClose}
      size="lg"
      title={formatDate(photo.date, { weekday: true })}
      footer={
        <>
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirm({ title: 'Удалить фото?', text: 'Фото будет удалено с устройства без возможности восстановления (кроме резервных копий).', danger: true, confirm: 'Удалить' })) {
                await deletePhoto(photo.id);
                toast('Фото удалено');
                onClose();
              }
            }}
          >
            <Icon name="trash" size={18} /> Удалить
          </button>
          <button
            className="btn primary"
            disabled={!dirty || date > today()}
            onClick={async () => {
              await updatePhotoMeta({ ...photo, note: note.slice(0, 500), category: cat, date });
              toast('Сохранено', { tone: 'success' });
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="viewer-img">{url ? <img src={url} alt={`Фото ${CATEGORY_LABELS[photo.category]}`} /> : <div className="skeleton" style={{ height: 360 }} />}</div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="v-cat">Ракурс</label>
          <select id="v-cat" className="input" value={cat} onChange={(e) => setCat(e.target.value as PhotoCategory)}>
            {(Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-date">Дата</label>
          <input id="v-date" className="input" type="date" max={today()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="v-note">Заметка</label>
        <input id="v-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="xs faint">{photo.width}×{photo.height} · {(photo.size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ</p>
    </Sheet>
  );
}

/** Live camera with an optional translucent overlay of the previous photo, for consistent poses. */
function CameraSheet({ onClose, onCaptured, onFallback }: { onClose: () => void; onCaptured: (p: PreparedPhoto) => void; onFallback: () => void }) {
  const data = useData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [ghost, setGhost] = useState(true);
  const [cat, setCat] = useState<PhotoCategory>('front');
  const [timer, setTimer] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const prev = data.photos.find((p) => p.category === cat) ?? null;
  const ghostUrl = usePhotoURL(prev?.id ?? null, 'blob', ghost && !!prev);
  const { toast } = useFeedback();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна в этом браузере.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setError(null);
      })
      .catch(() => setError('Нет доступа к камере. Разреши доступ в настройках браузера или загрузи фото из галереи.'));
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    if (timer > 0) {
      for (let i = timer; i > 0; i--) {
        setCount(i);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCount(null);
    }
    try {
      const blob = await captureFrame(v, facing === 'user');
      const p = await preparePhoto(blob);
      onCaptured(p);
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };

  return (
    <Sheet open onClose={onClose} title="Снимок прогресса" size="lg">
      {error ? (
        <div className="stack">
          <Notice tone="warn">{error}</Notice>
          <button className="btn primary" onClick={onFallback}>Выбрать из галереи</button>
        </div>
      ) : (
        <>
          <div className="camera">
            <video ref={videoRef} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
            {ghost && ghostUrl && <img className="ghost" src={ghostUrl} alt="" />}
            {count != null && <div className="countdown num">{count}</div>}
          </div>
          <div className="row wrap between">
            <Segmented label="Ракурс" value={cat} onChange={setCat} items={(Object.keys(CATEGORY_LABELS) as PhotoCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
            <div className="row">
              <button className={`chip ${ghost ? 'on' : ''}`} onClick={() => setGhost(!ghost)} disabled={!prev} title="Наложить прошлое фото для одинаковой позы">
                <Icon name="layers" size={16} /> Контур
              </button>
              <button className="chip" onClick={() => setTimer(timer === 0 ? 3 : timer === 3 ? 10 : 0)}>
                <Icon name="clock" size={16} /> {timer ? `${timer} с` : 'Таймер'}
              </button>
              <button className="chip" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label="Сменить камеру">
                <Icon name="flip" size={16} />
              </button>
            </div>
          </div>
          <button className="btn primary lg block" onClick={shoot} disabled={count != null}>
            <Icon name="camera" size={20} /> Снять
          </button>
        </>
      )}
    </Sheet>
  );
}
