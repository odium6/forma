import { useMemo, useRef, useState } from 'react';
import type { ActivityLevel, BodyShapeGoal, MeasurementKey, Sex } from '@/domain/types';
import { addCustomMetric, addEntry, refreshAfterImport, saveProfile, saveSettings } from '@/state/store';
import { ageFromBirthYear, formatDate, nowTime, today } from '@/lib/dates';
import { fmtKg, fmtNum, parseDecimal } from '@/lib/format';
import { ACTIVITY_LABELS, BMI_LABELS, bmi, bmiCategory, healthyWeightRange, LIMITS, tdee } from '@/lib/math/body';
import { calorieGuidance, weeksAtPace } from '@/lib/math/goals';
import { MEASUREMENT_LABELS } from '@/lib/metrics';
import { parseBackup, restoreBackup } from '@/lib/backup/backup';
import { requestPersistence } from '@/app/pwa';
import { addDays } from '@/lib/dates';
import { LogoMark } from '@/ui/Logo';
import { Icon } from '@/ui/Icon';
import { ChipGroup, NumberField, Notice, fieldValid } from '@/ui/controls';
import { useFeedback } from '@/ui/feedback';
import { GoalEditor, goalDraftValid, paceValue, SHAPES, useGoalEvaluation, type GoalDraft } from '@/features/goal/GoalEditor';
import { saveGoalDraft } from '@/features/goal/saveGoal';
import './onboarding.css';

const STEPS = ['Привет', 'О тебе', 'Вес', 'Цель', 'Измерения', 'Образ', 'Итог'] as const;

export default function Onboarding() {
  const { toast } = useFeedback();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState<ActivityLevel>('light');
  const [goal, setGoal] = useState<GoalDraft>({ mode: 'loss', target: '', date: '', pace: 'calm', bodyFat: '', tolerance: '1,5' });
  const [bodyFat, setBodyFat] = useState('');
  const [meas, setMeas] = useState<Partial<Record<string, string>>>({});
  const [custom, setCustom] = useState<{ name: string; unit: string; value: string }[]>([]);
  const [shape, setShape] = useState<BodyShapeGoal>('leaner');
  const [shapeNote, setShapeNote] = useState('');
  const [targetWaist, setTargetWaist] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const by = parseDecimal(birthYear);
  const h = parseDecimal(height);
  const w = parseDecimal(weight);
  const age = by != null ? ageFromBirthYear(by) : null;
  const profile = sex && by != null && h != null ? { sex, birthYear: by, heightCm: h } : null;
  const ev = useGoalEvaluation(goal, profile, w);

  const valid = [
    true,
    !!sex && fieldValid(birthYear, LIMITS.birthYear.min, LIMITS.birthYear.max, true) && fieldValid(height, LIMITS.height.min, LIMITS.height.max, true),
    fieldValid(weight, LIMITS.weight.min, LIMITS.weight.max, true),
    goalDraftValid(goal, ev),
    fieldValid(bodyFat, LIMITS.bodyFat.min, LIMITS.bodyFat.max) && Object.values(meas).every((v) => fieldValid(v ?? '', LIMITS.measurement.min, LIMITS.measurement.max)),
    shape !== 'custom' || shapeNote.trim().length > 0,
    true,
  ];

  const plan = useMemo(() => {
    if (!profile || w == null || age == null) return null;
    const isMinor = age < 18;
    const t = parseDecimal(goal.target);
    const pace = goal.mode === 'maintain' ? 0 : paceValue(goal.mode, goal.pace, isMinor);
    const effectivePace = ev?.requiredPctPerWeek != null && goal.date ? Math.max(ev.requiredPctPerWeek, 0.05) : pace;
    const weeks = t != null && goal.mode !== 'maintain' ? weeksAtPace(w, t - w, effectivePace) : null;
    const b = bmi(w, profile.heightCm);
    const energy = !isMinor ? tdee(profile.sex, w, profile.heightCm, age, activity) : null;
    const kcal = energy != null && goal.mode !== 'maintain' ? calorieGuidance(energy, profile.sex, goal.mode, effectivePace, w) : null;
    return {
      isMinor,
      bmi: b,
      bmiCat: bmiCategory(b, age),
      range: !isMinor ? healthyWeightRange(profile.heightCm) : null,
      weeks,
      eta: weeks != null && Number.isFinite(weeks) ? addDays(today(), Math.ceil(weeks * 7)) : null,
      kgPerWeek: (w * effectivePace) / 100,
      energy,
      kcal,
    };
  }, [profile, w, age, goal, ev, activity]);

  const finish = async () => {
    if (!profile || w == null || busy) return;
    setBusy(true);
    try {
      const now = Date.now();
      await saveProfile({ name: name.trim().slice(0, 60), sex: profile.sex, birthYear: profile.birthYear, heightCm: profile.heightCm, activity, createdAt: now, updatedAt: now });
      const measurements: Partial<Record<MeasurementKey, number>> = {};
      for (const [k, v] of Object.entries(meas)) {
        const n = parseDecimal(v ?? '');
        if (n != null) measurements[k as MeasurementKey] = n;
      }
      for (const c of custom.filter((x) => x.name.trim())) {
        const m = await addCustomMetric(c.name, c.unit || 'см', null);
        const n = parseDecimal(c.value);
        if (n != null && n >= LIMITS.measurement.min && n <= LIMITS.measurement.max) measurements[`custom:${m.id}`] = n;
      }
      await addEntry({ date: today(), time: nowTime(), weight: w, bodyFat: parseDecimal(bodyFat), measurements, note: 'Стартовая точка' });
      const tw = parseDecimal(targetWaist);
      await saveGoalDraft(goal, w, { shape, shapeNote, targetMeasurements: tw != null ? { waist: tw } : {} });
      const persisted = await requestPersistence();
      await saveSettings({ onboarded: true, persistentStorage: persisted });
    } catch (e) {
      console.error(e);
      toast('Не удалось сохранить данные', { tone: 'error' });
      setBusy(false);
    }
  };

  const importBackup = async (file: File) => {
    const res = await parseBackup(file);
    if (!res.ok) {
      toast(res.error, { tone: 'error' });
      return;
    }
    await restoreBackup(res.backup, 'replace');
    await refreshAfterImport();
    toast('Данные восстановлены из резервной копии', { tone: 'success' });
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish());

  return (
    <div className="onb">
      {step > 0 && (
        <div className="onb-top">
          <button className="btn icon ghost" onClick={() => setStep(step - 1)} aria-label="Назад">
            <Icon name="left" />
          </button>
          <div className="onb-progress" aria-label={`Шаг ${step} из ${STEPS.length - 1}`}>
            {STEPS.slice(1).map((s, i) => (
              <span key={s} className={i < step ? 'on' : ''} />
            ))}
          </div>
          <span className="small muted num">{step}/{STEPS.length - 1}</span>
        </div>
      )}
      <div className="onb-body" key={step}>
        {step === 0 && (
          <div className="onb-welcome">
            <LogoMark size={88} />
            <h1>FORMA</h1>
            <p className="onb-lead">Персональный трекер веса, формы тела и привычек — с честной математикой и без лишнего шума.</p>
            <ul className="onb-points">
              <li><Icon name="chart" size={20} /> Сглаженный тренд и прогноз с диапазоном неопределённости</li>
              <li><Icon name="shield" size={20} /> Безопасные цели и бережный темп</li>
              <li><Icon name="lock" size={20} /> Данные и фото хранятся только на этом устройстве</li>
            </ul>
          </div>
        )}
        {step === 1 && (
          <section className="stack">
            <h2>Расскажи о себе</h2>
            <p className="muted">Эти данные нужны для расчёта ИМТ, безопасного темпа и энергетических ориентиров.</p>
            <div className="field">
              <label htmlFor="onb-name">Как к тебе обращаться (необязательно)</label>
              <input id="onb-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
            </div>
            <div className="field">
              <span className="field-label">Пол (для формул расчёта)</span>
              <ChipGroup label="Пол" value={sex ?? ('' as Sex)} onChange={(v) => setSex(v as Sex)} options={[{ value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }]} />
            </div>
            <div className="grid-2">
              <NumberField label="Год рождения" value={birthYear} onChange={setBirthYear} min={LIMITS.birthYear.min} max={LIMITS.birthYear.max} required placeholder="1995" testId="onb-year" />
              <NumberField label="Рост" value={height} onChange={setHeight} suffix="см" min={LIMITS.height.min} max={LIMITS.height.max} required placeholder="170" testId="onb-height" />
            </div>
            {age != null && age < 18 && age >= 8 && (
              <Notice>Для людей младше 18 лет FORMA не применяет взрослые нормы и не даёт персональных рекомендаций по снижению веса. Отслеживание и привычки доступны полностью.</Notice>
            )}
          </section>
        )}
        {step === 2 && (
          <section className="stack">
            <h2>Текущий вес и активность</h2>
            <NumberField label="Текущий вес" big value={weight} onChange={setWeight} suffix="кг" min={LIMITS.weight.min} max={LIMITS.weight.max} required placeholder="0,0" autoFocus testId="onb-weight" />
            <div className="field">
              <span className="field-label">Уровень активности</span>
              <div className="list activity" role="radiogroup" aria-label="Уровень активности">
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={activity === a} className="list-item act" onClick={() => setActivity(a)}>
                    <span className={`radio ${activity === a ? 'on' : ''}`} />
                    <span className="grow">
                      <span className="strong">{ACTIVITY_LABELS[a].title}</span>
                      <span className="small muted" style={{ display: 'block' }}>{ACTIVITY_LABELS[a].hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="stack">
            <h2>Твоя цель</h2>
            <p className="muted">Все параметры можно изменить позже — история измерений при этом сохраняется.</p>
            <GoalEditor draft={goal} onChange={setGoal} profile={profile} currentWeight={w} />
          </section>
        )}
        {step === 4 && (
          <section className="stack">
            <h2>Измерения тела</h2>
            <p className="muted">Необязательно. Обхваты часто меняются, даже когда вес стоит на месте.</p>
            <NumberField label="Процент жира" value={bodyFat} onChange={setBodyFat} suffix="%" min={LIMITS.bodyFat.min} max={LIMITS.bodyFat.max} />
            <div className="grid-2">
              {Object.entries(MEASUREMENT_LABELS).map(([k, label]) => (
                <NumberField key={k} label={label} value={meas[k] ?? ''} onChange={(v) => setMeas((m) => ({ ...m, [k]: v }))} suffix="см" min={LIMITS.measurement.min} max={LIMITS.measurement.max} />
              ))}
            </div>
            <div className="field">
              <span className="field-label">Свои параметры</span>
              {custom.map((c, i) => (
                <div key={i} className="row custom-row">
                  <input className="input grow" placeholder="Название" maxLength={40} value={c.name} aria-label="Название параметра" onChange={(e) => setCustom((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <input className="input" style={{ width: 80 }} placeholder="ед." maxLength={12} value={c.unit} aria-label="Единица" onChange={(e) => setCustom((x) => x.map((y, j) => (j === i ? { ...y, unit: e.target.value } : y)))} />
                  <input className="input num" style={{ width: 90 }} inputMode="decimal" placeholder="значение" value={c.value} aria-label="Значение" onChange={(e) => setCustom((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
                  <button type="button" className="btn icon ghost" aria-label="Удалить параметр" onClick={() => setCustom((x) => x.filter((_, j) => j !== i))}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setCustom((x) => [...x, { name: '', unit: 'см', value: '' }])}>
                <Icon name="plus" size={16} /> Добавить параметр
              </button>
            </div>
          </section>
        )}
        {step === 5 && (
          <section className="stack">
            <h2>Какой ты видишь свою форму?</h2>
            <p className="muted">Здесь нет «идеальных» пропорций — только твои ориентиры. Это помогает FORMA подбирать формулировки и акценты.</p>
            <div className="shape-grid" role="group" aria-label="Желаемая форма">
              {SHAPES.map((s) => (
                <button key={s.value} type="button" className="shape" aria-pressed={shape === s.value} onClick={() => setShape(s.value)}>
                  <span className="shape-icon" aria-hidden="true">{s.icon}</span>
                  <span className="strong">{s.title}</span>
                  <span className="small muted">{s.hint}</span>
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="shape-note">Опиши своими словами {shape === 'custom' ? '' : '(необязательно)'}</label>
              <textarea id="shape-note" className="input" maxLength={300} value={shapeNote} onChange={(e) => setShapeNote(e.target.value)} placeholder="Например: подтянутый живот и больше энергии по утрам" />
            </div>
            <NumberField label="Желаемая талия (необязательно)" value={targetWaist} onChange={setTargetWaist} suffix="см" min={LIMITS.measurement.min} max={LIMITS.measurement.max} />
          </section>
        )}
        {step === 6 && plan && w != null && (
          <section className="stack">
            <h2>Твоя стартовая точка</h2>
            <div className="summary-grid">
              <div className="card flat">
                <div className="eyebrow">Старт</div>
                <div className="big-num num">{fmtNum(w, 1)} <small>кг</small></div>
                <div className="small muted">{formatDate(today(), { year: true })}</div>
              </div>
              {!plan.isMinor && (
                <div className="card flat">
                  <div className="eyebrow">ИМТ</div>
                  <div className="big-num num">{fmtNum(plan.bmi, 1)}</div>
                  <div className="small muted">{plan.bmiCat ? BMI_LABELS[plan.bmiCat] : ''}</div>
                </div>
              )}
              {goal.mode !== 'maintain' && parseDecimal(goal.target) != null && (
                <div className="card flat">
                  <div className="eyebrow">Цель</div>
                  <div className="big-num num">{fmtNum(parseDecimal(goal.target)!, 1)} <small>кг</small></div>
                  <div className="small muted">{fmtKg(Math.abs(parseDecimal(goal.target)! - w))} {goal.mode === 'loss' ? 'снизить' : 'набрать'}</div>
                </div>
              )}
              {goal.mode === 'maintain' && (
                <div className="card flat">
                  <div className="eyebrow">Диапазон</div>
                  <div className="big-num num">±{goal.tolerance} <small>кг</small></div>
                  <div className="small muted">режим поддержания</div>
                </div>
              )}
            </div>
            {goal.mode !== 'maintain' && plan.eta && (
              <div className="card">
                <div className="eyebrow">Предварительный прогноз</div>
                <p style={{ marginTop: 6 }}>
                  При темпе ≈ <span className="num strong">{fmtNum(plan.kgPerWeek, 2)} кг/нед</span> цель достижима примерно к <strong>{formatDate(plan.eta, { year: true })}</strong>.
                </p>
                <p className="small muted" style={{ marginTop: 6 }}>Это план. Реальный прогноз FORMA построит по твоему тренду через 1–2 недели регулярных измерений.</p>
              </div>
            )}
            {plan.range && (
              <p className="small muted">Здоровый диапазон веса для роста {fmtNum(profile!.heightCm, 0)} см: {fmtNum(plan.range.min, 1)}–{fmtNum(plan.range.max, 1)} кг (ИМТ 18,5–24,9). Это популяционный ориентир, а не требование.</p>
            )}
            {plan.kcal && plan.energy && (
              <div className="card flat">
                <div className="eyebrow">Ориентир по энергии</div>
                <p style={{ marginTop: 6 }}>
                  Расход ≈ <span className="num strong">{Math.round(plan.energy / 10) * 10} ккал</span>, для выбранного темпа ≈ <span className="num strong">{Math.round(plan.kcal.kcal / 10) * 10} ккал</span> в день.
                </p>
                <p className="small muted" style={{ marginTop: 4 }}>
                  Приблизительная оценка, не медицинская рекомендация.
                </p>
              </div>
            )}
            {plan.isMinor && <Notice>Персональные рекомендации по снижению веса и калорийности для младше 18 лет не формируются — обсуди цели с педиатром.</Notice>}
            <Notice icon="database">Все данные хранятся только на этом устройстве. Регулярно делай резервную копию в настройках — её можно восстановить на другом устройстве.</Notice>
          </section>
        )}
      </div>
      <div className="onb-actions">
        <button className="btn primary lg block" disabled={!valid[step] || busy} onClick={next} data-testid="onb-next">
          {step === 0 ? 'Начать' : step === STEPS.length - 1 ? 'Перейти к FORMA' : step === 4 || step === 5 ? 'Далее' : 'Продолжить'}
        </button>
        {step === 0 && (
          <>
            <button className="btn ghost block" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={18} /> Восстановить из резервной копии
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
          </>
        )}
        {(step === 4 || step === 5) && (
          <button className="btn ghost block" onClick={() => setStep(step + 1)}>Пропустить</button>
        )}
      </div>
    </div>
  );
}
