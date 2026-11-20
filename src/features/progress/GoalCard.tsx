import { useState } from 'react';
import type { AppData, BodyShapeGoal } from '@/domain/types';
import type { Summary } from '@/lib/summary';
import { setMaintenance, updateGoal } from '@/state/store';
import { formatDate, today } from '@/lib/dates';
import { fmtKg, fmtNum, parseDecimal } from '@/lib/format';
import { GoalEditor, goalDraftValid, SHAPES, useGoalEvaluation, type GoalDraft } from '@/features/goal/GoalEditor';
import { saveGoalDraft } from '@/features/goal/saveGoal';
import { Sheet } from '@/ui/Sheet';
import { NumberField, Notice } from '@/ui/controls';
import { useFeedback } from '@/ui/feedback';
import { Icon } from '@/ui/Icon';

export function GoalCard({ data, summary: s }: { data: AppData; summary: Summary }) {
  const [editing, setEditing] = useState(false);
  const { toast, confirm } = useFeedback();
  const g = s.goal;
  const m = data.maintenance?.enabled ? data.maintenance : null;
  const shape = g ? SHAPES.find((x) => x.value === g.shape) : null;

  const markAchieved = async () => {
    if (!g) return;
    await updateGoal({ ...g, status: 'achieved', achievedAt: today() });
    toast('Поздравляем! Цель отмечена как достигнутая', { tone: 'success' });
  };

  const startMaintenance = async () => {
    if (s.current == null) return;
    if (g && g.status === 'active') await updateGoal({ ...g, status: s.progress?.state === 'reached' ? 'achieved' : 'archived', achievedAt: s.progress?.state === 'reached' ? today() : g.achievedAt });
    await setMaintenance({ enabled: true, centerWeight: Math.round(s.current * 100) / 100, toleranceKg: 1.5, startedAt: today() });
    toast('Режим поддержания включён', { tone: 'success' });
  };

  return (
    <section className="card" id="goal">
      <div className="card-head">
        <h2>{m ? 'Поддержание' : 'Цель'}</h2>
        <button className="btn sm" onClick={() => setEditing(true)} data-testid="edit-goal">
          <Icon name="edit" size={16} /> {g || m ? 'Изменить' : 'Задать'}
        </button>
      </div>
      {m ? (
        <div className="stack small" style={{ ['--gap' as string]: '8px' }}>
          <p>
            Целевой диапазон: <span className="num strong">{fmtNum(m.centerWeight - m.toleranceKg, 2)}–{fmtNum(m.centerWeight + m.toleranceKg, 2)} кг</span>
          </p>
          <p className="muted">С {formatDate(m.startedAt)}. {s.maintenance?.state === 'inside' ? 'Сейчас тренд внутри диапазона.' : s.maintenance ? `Тренд ${s.maintenance.state === 'above' ? 'выше' : 'ниже'} диапазона на ${fmtKg(Math.abs(s.maintenance.deviation))}.` : ''}</p>
          <button
            className="btn sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              if (await confirm({ title: 'Выключить режим поддержания?', text: 'История сохранится. Можно будет задать новую цель.' })) await setMaintenance({ ...m, enabled: false });
            }}
          >
            Выключить поддержание
          </button>
        </div>
      ) : g ? (
        <div className="stack small" style={{ ['--gap' as string]: '8px' }}>
          <p>
            {fmtKg(g.startWeight)} → <span className="strong num">{g.targetWeight != null ? fmtKg(g.targetWeight) : '—'}</span>
            {g.targetDate && <span className="muted"> к {formatDate(g.targetDate)}</span>}
          </p>
          <p className="muted">
            Старт {formatDate(g.startDate)} · темп ≈ {fmtNum(g.pacePctPerWeek, 2)}%/нед
            {g.targetBodyFat != null && ` · жир ${fmtNum(g.targetBodyFat, 0)}%`}
          </p>
          {shape && <p className="muted">{shape.icon} {shape.title}{g.shapeNote ? ` — ${g.shapeNote}` : ''}</p>}
          {s.progress?.state === 'reached' && (
            <div className="stack" style={{ ['--gap' as string]: '8px', marginTop: 6 }}>
              <Notice tone="positive">Тренд достиг цели! Отметь её и выбери, что дальше: поддерживать форму или поставить новую цель.</Notice>
              <div className="row wrap">
                <button className="btn primary sm" onClick={markAchieved}>Цель достигнута</button>
                <button className="btn sm" onClick={startMaintenance}>Режим поддержания</button>
              </div>
            </div>
          )}
          {s.progress?.state !== 'reached' && (
            <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={startMaintenance}>Перейти в режим поддержания</button>
          )}
        </div>
      ) : (
        <p className="small muted">Цель не задана. Можно отслеживать вес и без цели — или задать её, чтобы видеть прогресс и прогноз.</p>
      )}
      {editing && <GoalSheet data={data} summary={s} onClose={() => setEditing(false)} />}
    </section>
  );
}

function GoalSheet({ data, summary: s, onClose }: { data: AppData; summary: Summary; onClose: () => void }) {
  const { toast } = useFeedback();
  const g = s.goal;
  const m = data.maintenance?.enabled ? data.maintenance : null;
  const current = s.current != null ? Math.round(s.current * 100) / 100 : null;
  const [draft, setDraft] = useState<GoalDraft>({
    mode: m ? 'maintain' : g?.targetWeight != null && current != null && g.targetWeight > current ? 'gain' : 'loss',
    target: g?.targetWeight != null ? String(g.targetWeight).replace('.', ',') : '',
    date: g?.targetDate ?? '',
    pace: 'calm',
    bodyFat: g?.targetBodyFat != null ? String(g.targetBodyFat).replace('.', ',') : '',
    tolerance: m ? String(m.toleranceKg).replace('.', ',') : '1,5',
  });
  const [shape, setShape] = useState<BodyShapeGoal>(g?.shape ?? 'leaner');
  const [note, setNote] = useState(g?.shapeNote ?? '');
  const [waist, setWaist] = useState(g?.targetMeasurements.waist != null ? String(g.targetMeasurements.waist).replace('.', ',') : '');
  const ev = useGoalEvaluation(draft, data.profile, current);
  const valid = goalDraftValid(draft, ev) && current != null;

  const save = async () => {
    if (!valid || current == null) return;
    const w = parseDecimal(waist);
    await saveGoalDraft(draft, current, { shape, shapeNote: note, targetMeasurements: w != null ? { ...(g?.targetMeasurements ?? {}), waist: w } : {} });
    toast(draft.mode === 'maintain' ? 'Режим поддержания сохранён' : 'Новая цель сохранена. Прогресс считается от текущего веса', { tone: 'success' });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Цель"
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid} onClick={save} data-testid="goal-save">Сохранить</button>
        </>
      }
    >
      {current == null ? (
        <Notice>Сначала внеси хотя бы одно измерение веса.</Notice>
      ) : (
        <>
          <p className="small muted">Стартовая точка новой цели — текущий сглаженный вес {fmtKg(current)}. История измерений не меняется.</p>
          <GoalEditor draft={draft} onChange={setDraft} profile={data.profile} currentWeight={current} />
          {draft.mode !== 'maintain' && (
            <>
              <div className="field">
                <span className="field-label">Желаемая форма</span>
                <div className="chips">
                  {SHAPES.map((x) => (
                    <button key={x.value} type="button" className="chip" aria-pressed={shape === x.value} onClick={() => setShape(x.value)}>
                      {x.icon} {x.title}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="goal-note">Описание (необязательно)</label>
                <input id="goal-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <NumberField label="Желаемая талия (необязательно)" value={waist} onChange={setWaist} suffix="см" min={5} max={300} />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
