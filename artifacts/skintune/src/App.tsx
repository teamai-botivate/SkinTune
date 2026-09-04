import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, Clock3, FileText, Heart, Info, LockKeyhole, Pencil, RefreshCw,
  RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Upload, Wand2, X, SlidersHorizontal,
} from 'lucide-react';
import { searchDresses, tryOnDress } from './services/dress-search';
import { analyzePhoto } from './services/photo-analysis';
import { createActivityLog, type LogStep } from './lib/activity-log';
import { photoAnalysisStages, photoDiagnostics } from './data/photo-diagnostics';
import {
  ageGroupOptions, bodyBuildOptions, budgetOptions, colorAvoidOptions, colorLoveOptions,
  fitOptions, homeOccasionShortcuts,
  impressionOptions, occasionOptions, pronounOptions,
  restrictionOptions, styleOptions, type SelectOption,
} from './data/options';
import type { DressResult, PhotoStatus, ShopLink, SkinTuneProfile } from './types';

const queryClient = new QueryClient();

type Screen =
  | 'welcome' | 'home' | 'name' | 'profile' | 'age' | 'height' | 'consent' | 'photo' | 'appearance'
  | 'body-style' | 'colors-occasion' | 'final-prefs' | 'review' | 'generating' | 'dresses'
  | 'dress-detail' | 'try-on' | 'settings';

const initialProfile: SkinTuneProfile = {
  name: '', pronouns: '', ageGroup: '', height: '', photoUrl: '', bodyBuild: '',
  appearance: { skinTone: '', undertone: '', confidence: 0, contrast: 'Medium' },
  fit: '', style: [], colorsLove: [], colorsAvoid: [], restrictions: [],
  occasion: '', impression: [], budget: '',
};

// After the photo step, the remaining questions are grouped into three
// section screens (each holding several related fields with checkbox-style
// cards) instead of one screen per field — this cuts an 11-screen tap-through
// down to 3 sections so filling in preferences after photo upload takes
// meaningfully less time.
const wizardScreens: Screen[] = [
  'name', 'profile', 'age', 'height', 'consent', 'photo', 'appearance',
  'body-style', 'colors-occasion', 'final-prefs', 'review',
];
const WIZARD_TOTAL = wizardScreens.length;

// ---------- Shared primitives ----------

function OptionCard({ label, description, icon, selected, onClick, disabled = false }: {
  label: string; description?: string; icon?: string; selected: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={`option-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} aria-pressed={selected}
      className={`focus-ring group relative flex min-h-[76px] w-full items-center gap-4 rounded-[1.15rem] border p-4 text-left transition duration-200 ${selected ? 'border-primary bg-primary/8 shadow-[0_8px_24px_hsl(var(--primary)/.12)]' : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/45'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      {icon ? (
        <span className={`grid size-11 shrink-0 place-items-center rounded-full text-xl ${selected ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`} aria-hidden>{icon}</span>
      ) : (
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`} aria-hidden><Check size={16} strokeWidth={3} className={selected ? '' : 'opacity-0'} /></span>
      )}
      <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span>{description && <span className="mt-1 block text-sm leading-snug text-muted-foreground">{description}</span>}</span>
      <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent'}`}><Check size={14} strokeWidth={3} /></span>
    </button>
  );
}

function ChoiceGrid({ options, value, toggle, multi = false }: { options: SelectOption[]; value: string | string[]; toggle: (label: string) => void; multi?: boolean }) {
  return <div className="grid gap-3 sm:grid-cols-2">{options.map((item) => {
    const selected = multi ? (value as string[]).includes(item.label) : value === item.label;
    return <OptionCard key={item.label} label={item.label} description={item.description} icon={item.icon} selected={selected} onClick={() => toggle(item.label)} />;
  })}</div>;
}

function Header({ onBack, onSettings, step, total, name }: { onBack?: () => void; onSettings: () => void; step?: number; total?: number; name?: string }) {
  return <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 px-4 py-4 backdrop-blur-md sm:px-8">
    <div className="mx-auto flex max-w-6xl items-center justify-between">
      <div className="flex items-center gap-3">
        {onBack ? <button type="button" onClick={onBack} data-testid="button-back" className="focus-ring rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground" aria-label="Go back"><ArrowLeft size={19} /></button> : <span className="size-9" />}
        <button type="button" onClick={onSettings} data-testid="button-open-settings" className="focus-ring flex items-center gap-2" aria-label="Open SkinTune home">
          <span className="grid size-9 place-items-center rounded-[13px] bg-primary text-primary-foreground shadow-sm"><Sparkles size={18} /></span>
          <span className="font-serif text-xl font-semibold tracking-tight">SkinTune</span>
        </button>
      </div>
      {step && total && <div className="hidden items-center gap-3 sm:flex"><span className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">Your edit</span><div className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(step / total) * 100}%` }} /></div><span className="text-sm text-muted-foreground">{step} / {total}</span></div>}
      {name ? <button type="button" onClick={onSettings} data-testid="button-profile-menu" className="focus-ring flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-secondary"><span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{name.slice(0, 1).toUpperCase()}</span><span className="hidden text-sm font-semibold sm:block">{name}</span><ChevronDown size={15} className="text-muted-foreground" /></button> : <span className="size-9" />}
    </div>
  </header>;
}

function Intro({ eyebrow, title, body, children }: { eyebrow: string; title: string; body?: string; children: ReactNode }) {
  return <div className="animate-rise"><p className="mb-4 text-xs font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p><h1 className="max-w-2xl font-serif text-[clamp(2.25rem,6vw,4.6rem)] leading-[.98] tracking-[-.045em]">{title}</h1>{body && <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">{body}</p>}<div className="mt-8">{children}</div></div>;
}

function FooterActions({ onBack, onContinue, disabled = false, label = 'Continue' }: { onBack?: () => void; onContinue: () => void; disabled?: boolean; label?: string }) {
  return <div className="sticky bottom-0 -mx-4 mt-10 flex flex-col-reverse gap-3 border-t border-border/70 bg-background/95 px-4 py-4 backdrop-blur-md sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:px-0 sm:pt-6 sm:backdrop-blur-none">
    <button type="button" onClick={onBack} disabled={!onBack} data-testid="button-step-back" className="focus-ring inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:invisible"><ArrowLeft size={16} /> Back</button>
    <button type="button" onClick={onContinue} disabled={disabled} data-testid="button-continue" className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-bold text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/.2)] transition hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45">{label}<ArrowRight size={17} /></button>
  </div>;
}

function Shell({ children, onBack, onSettings, step, total, profile }: { children: ReactNode; onBack?: () => void; onSettings: () => void; step?: number; total?: number; profile: SkinTuneProfile }) {
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onSettings} step={step} total={total} name={profile.name} /><main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-16">{children}</main></div>;
}

function StepShell({ profile, children, onBack, step, total = WIZARD_TOTAL }: { profile: SkinTuneProfile; children: ReactNode; onBack: () => void; step: number; total?: number }) {
  return <Shell profile={profile} onBack={onBack} onSettings={onBack} step={step} total={total}><div className="mx-auto max-w-2xl">{children}</div></Shell>;
}

// ---------- Generic wizard step components (replaces the old per-field duplicates) ----------

type StepBaseProps = {
  profile: SkinTuneProfile;
  update: (p: Partial<SkinTuneProfile>) => void;
  step: number;
  eyebrow: string;
  title: string;
  body?: string;
  onNext: () => void;
  onBack: () => void;
};

function SingleChoiceStep({ profile, update, field, step, eyebrow, title, body, options, onNext, onBack }: StepBaseProps & {
  field: keyof SkinTuneProfile; options: SelectOption[];
}) {
  const value = profile[field] as string;
  // Single-choice screens are tap-once: picking an option shows the
  // selection, then auto-advances shortly after so the flow feels like
  // "tap → next", not "tap → scroll down → tap continue". The footer
  // Continue button stays as a fallback (e.g. keyboard/switch-control users,
  // or someone who wants to double-check before moving on).
  const choose = (v: string) => {
    update({ [field]: v } as Partial<SkinTuneProfile>);
    window.setTimeout(onNext, 320);
  };
  return <StepShell profile={profile} onBack={onBack} step={step}>
    <Intro eyebrow={eyebrow} title={title} body={body}>
      <ChoiceGrid options={options} value={value} toggle={choose} />
      <FooterActions onBack={onBack} onContinue={onNext} disabled={!value} />
    </Intro>
  </StepShell>;
}

function MultiChoiceStep({ profile, update, field, step, eyebrow, title, body, options, onNext, onBack, max, optional = false }: StepBaseProps & {
  field: keyof SkinTuneProfile; options: SelectOption[]; max?: number; optional?: boolean;
}) {
  const values = (profile[field] as string[]) || [];
  const toggle = (v: string) => {
    const atMax = max !== undefined && values.length >= max && !values.includes(v);
    if (atMax) return;
    update({ [field]: values.includes(v) ? values.filter((item) => item !== v) : [...values, v] } as Partial<SkinTuneProfile>);
  };
  return <StepShell profile={profile} onBack={onBack} step={step}>
    <Intro eyebrow={eyebrow} title={title} body={max ? `${body ?? ''} Choose up to ${max}.`.trim() : body}>
      <ChoiceGrid multi options={options} value={values} toggle={toggle} />
      <FooterActions onBack={onBack} onContinue={onNext} disabled={!optional && values.length === 0} />
    </Intro>
  </StepShell>;
}

// A single field within a SectionStep: one heading + one choice grid (or a
// free-text area), rather than its own full screen. Lets several related
// questions live on one scrollable page with one Continue button, instead
// of forcing a tap-through for every individual field.
type SectionField =
  | { kind: 'single'; field: keyof SkinTuneProfile; label: string; hint?: string; options: SelectOption[]; required?: boolean }
  | { kind: 'multi'; field: keyof SkinTuneProfile; label: string; hint?: string; options: SelectOption[]; max?: number; required?: boolean }
  | { kind: 'text'; field: keyof SkinTuneProfile; label: string; hint?: string; placeholder: string; required?: boolean };

function isSectionFieldFilled(profile: SkinTuneProfile, def: SectionField): boolean {
  if (def.required === false) return true;
  const value = profile[def.field];
  if (def.kind === 'multi') return Array.isArray(value) && value.length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

function SectionStep({ profile, update, step, eyebrow, title, body, fields, onNext, onBack, continueLabel = 'Continue' }: {
  profile: SkinTuneProfile; update: (p: Partial<SkinTuneProfile>) => void; step: number;
  eyebrow: string; title: string; body?: string; fields: SectionField[];
  onNext: () => void; onBack: () => void; continueLabel?: string;
}) {
  const allRequiredFilled = fields.every((def) => def.required === false || isSectionFieldFilled(profile, def));
  return <StepShell profile={profile} onBack={onBack} step={step}>
    <Intro eyebrow={eyebrow} title={title} body={body}>
      <div className="space-y-9">
        {fields.map((def) => {
          const optionalTag = def.required === false ? <span className="ml-1.5 font-normal normal-case text-muted-foreground">optional</span> : null;
          if (def.kind === 'text') {
            const value = (profile[def.field] as string) ?? '';
            return <div key={def.field}>
              <p className="mb-2 text-sm font-bold">{def.label}{optionalTag}</p>
              {def.hint && <p className="mb-3 text-sm text-muted-foreground">{def.hint}</p>}
              <textarea value={value} onChange={(e) => update({ [def.field]: e.target.value } as Partial<SkinTuneProfile>)} data-testid={`textarea-${String(def.field)}`} rows={4} placeholder={def.placeholder} className="focus-ring w-full resize-none rounded-2xl border border-border bg-card p-4 leading-relaxed outline-none placeholder:text-muted-foreground/55" />
            </div>;
          }
          if (def.kind === 'single') {
            const value = profile[def.field] as string;
            return <div key={def.field}>
              <p className="mb-3 text-sm font-bold">{def.label}{optionalTag}</p>
              {def.hint && <p className="mb-3 -mt-2 text-sm text-muted-foreground">{def.hint}</p>}
              <ChoiceGrid options={def.options} value={value} toggle={(v) => update({ [def.field]: v } as Partial<SkinTuneProfile>)} />
            </div>;
          }
          const values = (profile[def.field] as string[]) || [];
          const toggle = (v: string) => {
            const atMax = def.max !== undefined && values.length >= def.max && !values.includes(v);
            if (atMax) return;
            update({ [def.field]: values.includes(v) ? values.filter((item) => item !== v) : [...values, v] } as Partial<SkinTuneProfile>);
          };
          return <div key={def.field}>
            <p className="mb-3 text-sm font-bold">{def.label}{optionalTag}{def.max ? <span className="ml-1.5 font-normal normal-case text-muted-foreground">choose up to {def.max}</span> : null}</p>
            {def.hint && <p className="mb-3 -mt-2 text-sm text-muted-foreground">{def.hint}</p>}
            <ChoiceGrid multi options={def.options} value={values} toggle={toggle} />
          </div>;
        })}
      </div>
      <FooterActions onBack={onBack} onContinue={onNext} disabled={!allRequiredFilled} label={continueLabel} />
    </Intro>
  </StepShell>;
}

function HeightStep({ profile, update, step, eyebrow, title, body, onNext, onBack }: StepBaseProps) {
  return <StepShell profile={profile} onBack={onBack} step={step}>
    <Intro eyebrow={eyebrow} title={title} body={body}>
      <label className="block max-w-md"><span className="sr-only">Height</span>
        <input value={profile.height} onChange={(e) => update({ height: e.target.value })} data-testid="input-height" placeholder="e.g. 5' 7&quot; (optional)" className="focus-ring w-full rounded-2xl border border-border bg-card px-5 py-4 text-lg outline-none placeholder:text-muted-foreground/55" />
      </label>
      <p className="mt-3 text-xs text-muted-foreground">Optional — helps us tune proportion suggestions.</p>
      <FooterActions onBack={onBack} onContinue={onNext} />
    </Intro>
  </StepShell>;
}

function NameStep({ profile, update, onNext, onBack }: { profile: SkinTuneProfile; update: (p: Partial<SkinTuneProfile>) => void; onNext: () => void; onBack: () => void }) {
  return <StepShell profile={profile} onBack={onBack} step={1}><Intro eyebrow="01 / welcome in" title="First, what should we call you?" body="This is your space. Use your real name, a nickname, or simply a word that feels like you."><label className="block max-w-md"><span className="sr-only">Your name</span><input autoFocus value={profile.name} onChange={(e) => update({ name: e.target.value })} data-testid="input-name" placeholder="Your name" className="focus-ring w-full rounded-2xl border border-border bg-card px-5 py-4 text-xl outline-none placeholder:text-muted-foreground/55" /></label><FooterActions onBack={onBack} onContinue={onNext} disabled={!profile.name.trim()} /></Intro></StepShell>;
}

function ConsentStep({ profile, onNext, onBack }: { profile: SkinTuneProfile; onNext: () => void; onBack: () => void }) {
  return <StepShell profile={profile} onBack={onBack} step={5}><Intro eyebrow="05 / your choice" title="A portrait can make color guidance more precise." body="If you choose to share one, we’ll look at visible styling cues like light, contrast, and framing. SkinTune does not identify you, diagnose anything, or judge attractiveness."><div className="space-y-3"><div className="flex gap-4 rounded-2xl border border-border bg-card p-5"><ShieldCheck className="mt-0.5 shrink-0 text-accent" /><div><p className="font-semibold">You stay in control</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Your photo stays in this browser prototype. Delete it any time from Privacy, plainly.</p></div></div><div className="flex gap-4 rounded-2xl border border-border bg-card p-5"><SlidersHorizontal className="mt-0.5 shrink-0 text-primary" /><div><p className="font-semibold">Guidance, not a verdict</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Every suggestion is optional. Your taste and comfort come first. No medical or diagnostic claims are made.</p></div></div></div><FooterActions onBack={onBack} onContinue={onNext} label="I’m comfortable continuing" /></Intro></StepShell>;
}

// ---------- Photo analysis ----------

// In-page camera capture. Deliberately avoids the native
// <input capture="user"> handoff to the OS camera app — on a meaningful
// share of mobile browsers that handoff either opens the wrong picker or
// silently fails to hand the captured photo back to the input's change
// event once the camera app closes. A live getUserMedia preview plus an
// explicit in-app capture button keeps the whole flow inside this page, so
// there's nothing to hand back and nothing that can silently drop the shot.
function CameraCapture({ onCapture, onClose }: { onCapture: (dataUrl: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access isn’t available in this browser. Try “Choose from Gallery” instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError('We couldn’t access your camera. Check your browser’s camera permission, or use “Choose from Gallery” instead.');
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Mirror horizontally so the captured photo matches what the user saw
    // in the front-camera preview (unmirrored feels visually "wrong" to
    // most people for a selfie).
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.92));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="Take a selfie">
      <button type="button" onClick={onClose} data-testid="button-camera-close" aria-label="Close camera" className="focus-ring absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X size={20} /></button>
      {error ? (
        <div className="max-w-sm rounded-2xl bg-card p-6 text-center">
          <p className="font-semibold">Camera unavailable</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <button type="button" onClick={onClose} data-testid="button-camera-dismiss" className="focus-ring mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">Got it</button>
        </div>
      ) : (
        <>
          <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-[1.5rem] bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="size-full scale-x-[-1] object-cover" data-testid="video-camera-preview" />
            {!ready && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting camera…</div>}
          </div>
          <button type="button" onClick={capture} disabled={!ready} data-testid="button-camera-capture" aria-label="Capture photo" className="focus-ring mt-6 grid size-16 place-items-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40">
            <span className="size-12 rounded-full bg-white" />
          </button>
          <p className="mt-4 text-sm text-white/70">Center your face, then tap to capture.</p>
        </>
      )}
    </div>
  );
}

function PhotoPanel({ profile, update, onContinue, onBack }: { profile: SkinTuneProfile; update: (p: Partial<SkinTuneProfile>) => void; onContinue: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<PhotoStatus>(profile.appearance.confidence ? 'good' : 'low-confidence');
  const [analyzing, setAnalyzing] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const diagnostic = photoDiagnostics[status];

  const runAnalysis = (photoUrl: string) => {
    setAnalyzing(true);
    setStageIndex(0);
    const stepMs = 550;
    const stageTimers = photoAnalysisStages.map((_, i) => window.setTimeout(() => setStageIndex(i), stepMs * i));
    const minDisplayMs = stepMs * photoAnalysisStages.length;
    const startedAt = Date.now();

    analyzePhoto(photoUrl).then((result) => {
      // Keep the staged progress on screen for at least its full run, even
      // if the real analysis returns faster, so it doesn't flash past.
      const elapsed = Date.now() - startedAt;
      const settle = () => {
        stageTimers.forEach((timer) => window.clearTimeout(timer));
        setAnalyzing(false);
        setStatus(result.status);
        update({ appearance: { skinTone: result.skinTone, undertone: result.undertone, confidence: result.confidence, contrast: result.contrast } });
      };
      if (elapsed >= minDisplayMs) settle();
      else window.setTimeout(settle, minDisplayMs - elapsed);
    });
  };

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      update({ photoUrl: dataUrl });
      runAnalysis(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const retry = () => {
    update({ photoUrl: '' });
    setStatus('low-confidence');
  };

  const handleCapture = (dataUrl: string) => {
    setShowCamera(false);
    update({ photoUrl: dataUrl });
    runAnalysis(dataUrl);
  };

  return <Shell profile={profile} onBack={onBack} onSettings={onBack} step={6} total={WIZARD_TOTAL}><div className="mx-auto max-w-3xl"><Intro eyebrow="06 / a gentle check" title="A photo helps us notice the details." body="This is only used to tune color and proportion suggestions. It is not a beauty score, identity check, or medical assessment.">
    {showCamera && <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />}
    <div className="mt-8 grid gap-6 md:grid-cols-[.84fr_1.16fr]">
      <div className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[1.5rem] border border-border bg-secondary/60 p-6">
        {profile.photoUrl ? <img src={profile.photoUrl} alt="Your uploaded portrait" data-testid="img-upload-preview" className="absolute inset-0 size-full object-cover" /> : <><div className="grid size-24 place-items-center rounded-full bg-card text-primary"><Camera size={34} /></div><p className="mt-4 text-center text-sm font-semibold">A natural, shoulders-up photo</p><p className="mt-1 text-center text-xs text-muted-foreground">No posing required.</p></>}
        <div className="absolute bottom-4 flex flex-wrap justify-center gap-2 px-4">
          <button type="button" onClick={() => setShowCamera(true)} data-testid="button-open-camera" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-lg"><Camera size={15} /> Take a Selfie</button>
          <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-bold shadow-lg"><Upload size={15} /> {profile.photoUrl ? 'Choose another' : 'Choose from Gallery'}<input type="file" accept="image/*" onChange={pickFile} data-testid="input-photo-gallery" className="sr-only" /></label>
        </div>
      </div>

      <div className={`rounded-[1.5rem] border p-6 ${analyzing ? 'border-border bg-secondary/50' : diagnostic.good ? 'border-accent/30 bg-accent/8' : 'border-primary/25 bg-primary/5'}`}>
        {analyzing ? (
          <div data-testid="panel-analyzing">
            <div className="flex items-center gap-3"><RefreshCw className="animate-spin text-primary" size={22} /><h2 className="font-serif text-2xl">{photoAnalysisStages[stageIndex]}</h2></div>
            <div className="mt-6 space-y-3">{photoAnalysisStages.map((stage, i) => <div key={stage} className={`flex items-center gap-3 text-sm transition ${i <= stageIndex ? 'opacity-100' : 'opacity-35'}`}><span className={`grid size-5 shrink-0 place-items-center rounded-full border ${i < stageIndex ? 'border-accent bg-accent text-accent-foreground' : 'border-border'}`}>{i < stageIndex && <Check size={11} strokeWidth={3} />}</span>{stage}</div>)}</div>
          </div>
        ) : !profile.photoUrl ? (
          <div>
            <p className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Photo check</p>
            <h2 className="mt-3 font-serif text-2xl">Waiting for a photo</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Choose a photo and we’ll check lighting, angle, and clarity right away.</p>
          </div>
        ) : diagnostic.good ? (
          <div data-testid="panel-photo-good">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Photo check</p><h2 className="mt-3 font-serif text-2xl">{diagnostic.title}</h2></div><CheckCircle2 className="text-accent" size={24} /></div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-card p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skin tone</p><p className="mt-1 font-serif text-lg">{profile.appearance.skinTone}</p></div>
              <div className="rounded-xl bg-card p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Undertone</p><p className="mt-1 font-serif text-lg">{profile.appearance.undertone}</p></div>
              <div className="rounded-xl bg-card p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</p><p className="mt-1 font-serif text-lg">{profile.appearance.confidence}%</p></div>
            </div>
            {import.meta.env.DEV && <details className="mt-7 border-t border-border/70 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Preview other diagnostics (dev only) <ChevronDown size={15} /></summary><div className="mt-3 grid grid-cols-2 gap-2">{(Object.keys(photoDiagnostics) as PhotoStatus[]).map((key) => <button type="button" key={key} onClick={() => setStatus(key)} data-testid={`button-diagnostic-${key}`} className={`focus-ring rounded-lg px-2 py-2 text-left text-xs transition ${status === key ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}`}>{photoDiagnostics[key].label}</button>)}</div></details>}
          </div>
        ) : (
          <div data-testid="panel-photo-problem">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-muted-foreground">Photo check · {diagnostic.label}</p><h2 className="mt-3 font-serif text-2xl">{diagnostic.title}</h2></div><CircleHelp className="text-primary" size={24} /></div>
            <div className="mt-5 space-y-4 text-sm leading-relaxed">
              <div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Problem</p><p className="mt-1">{diagnostic.problem}</p></div>
              <div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Why it matters</p><p className="mt-1 text-muted-foreground">{diagnostic.whyItMatters}</p></div>
              <div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">How to improve</p><p className="mt-1 text-muted-foreground">{diagnostic.howToImprove}</p></div>
            </div>
            <button type="button" onClick={retry} data-testid="button-retry-photo" className="focus-ring mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><Camera size={15} /> Retry Photo</button>
            {import.meta.env.DEV && <details className="mt-7 border-t border-border/70 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Preview other diagnostics (dev only) <ChevronDown size={15} /></summary><div className="mt-3 grid grid-cols-2 gap-2">{(Object.keys(photoDiagnostics) as PhotoStatus[]).map((key) => <button type="button" key={key} onClick={() => setStatus(key)} data-testid={`button-diagnostic-${key}`} className={`focus-ring rounded-lg px-2 py-2 text-left text-xs transition ${status === key ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}`}>{photoDiagnostics[key].label}</button>)}</div></details>}
          </div>
        )}
      </div>
    </div>
    <FooterActions onBack={onBack} onContinue={onContinue} disabled={!profile.photoUrl || !diagnostic.good || analyzing} />
  </Intro></div></Shell>;
}

function AppearanceStep({ profile, onNext, onPhoto, onBack }: { profile: SkinTuneProfile; onNext: () => void; onPhoto: () => void; onBack: () => void }) {
  return <StepShell profile={profile} onBack={onBack} step={7}><Intro eyebrow="07 / what we noticed" title="Your appearance profile is ready." body="Think of this as a creative starting point, not a label. We’ll use it to build harmony, then let your preferences lead."><div className="rounded-[1.5rem] border border-accent/25 bg-accent/7 p-6"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-full bg-accent text-accent-foreground"><Check size={20} /></div><div><p className="font-semibold">Your appearance profile is ready</p><p className="text-sm text-muted-foreground">A styling read based on your photo, not a verdict.</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Skin tone</p><p className="mt-1 font-serif text-xl">{profile.appearance.skinTone}</p></div><div className="rounded-xl bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Undertone</p><p className="mt-1 font-serif text-xl">{profile.appearance.undertone}</p></div><div className="rounded-xl bg-card p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Confidence</p><p className="mt-1 font-serif text-xl">{profile.appearance.confidence}%</p></div></div><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Analysis is based on your photo and is intended for styling recommendations only.</p></div><button type="button" onClick={onPhoto} data-testid="button-change-photo" className="focus-ring mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"><RotateCcw size={15} /> Use a different photo</button><FooterActions onBack={onBack} onContinue={onNext} /></Intro></StepShell>;
}

// ---------- Marketing / generating / results screens ----------

function Welcome({ onStart, onPrivacy }: { onStart: () => void; onPrivacy: () => void }) {
  return <div className="noise min-h-[100dvh] overflow-hidden"><div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-5 py-6 sm:px-10">
    <header className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground"><Sparkles size={19} /></span><span className="font-serif text-2xl font-semibold">SkinTune</span></div><button type="button" onClick={onPrivacy} data-testid="button-welcome-privacy" className="focus-ring rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary">Privacy, plainly</button></header>
    <div className="relative grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:gap-24">
      <div className="relative z-10 animate-rise"><p className="mb-5 text-xs font-bold uppercase tracking-[.24em] text-primary">A personal styling journal</p><h1 className="max-w-3xl font-serif text-[clamp(3.7rem,9vw,8.3rem)] leading-[.84] tracking-[-.06em]">Dress like<br /><em className="text-primary">yourself.</em></h1><p className="mt-8 max-w-lg text-lg leading-relaxed text-muted-foreground">SkinTune turns your real life, your coloring, and your point of view into supportive styling guidance that feels unmistakably yours.</p><button type="button" onClick={onStart} data-testid="button-start" className="focus-ring mt-9 inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 font-bold text-primary-foreground shadow-[0_12px_26px_hsl(var(--primary)/.22)] transition hover:-translate-y-1">Start your edit <ArrowRight size={18} /></button><p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole size={13} /> Private by design · about 4 minutes</p></div>
      <div className="relative mx-auto aspect-square w-full max-w-[470px] animate-floaty"><div className="absolute inset-[8%] rounded-[45%_55%_49%_51%/42%_43%_57%_58%] bg-secondary/80" /><div className="absolute inset-[17%] rounded-[52%_48%_42%_58%/54%_43%_57%_46%] border border-primary/20 bg-[#e8b493]" /><div className="absolute left-[31%] top-[28%] h-[45%] w-[39%] rounded-[45%_55%_48%_52%/40%_38%_62%_60%] bg-[#6d4038] shadow-[12px_22px_0_#cb7e61]" /><div className="absolute bottom-[19%] left-[22%] right-[20%] h-[26%] rounded-t-[50%] bg-accent" /><div className="absolute bottom-[12%] left-[31%] h-[10%] w-[37%] rounded-full bg-primary/85" /><div className="absolute -right-3 top-[17%] rounded-2xl border border-border bg-card px-4 py-3 shadow-xl"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Your palette</p><div className="mt-2 flex gap-1.5"><i className="size-5 rounded-full bg-[#c9a35c]" /><i className="size-5 rounded-full bg-[#1c1917]" /><i className="size-5 rounded-full bg-[#e8d5a3]" /><i className="size-5 rounded-full bg-[#8a6d3f]" /></div></div><div className="absolute -bottom-1 -left-3 max-w-[180px] rounded-2xl border border-border bg-card px-4 py-3 shadow-xl"><p className="text-sm font-semibold leading-tight">Not a score.<br /><span className="text-primary">A point of view.</span></p></div></div>
    </div>
    <footer className="flex flex-wrap justify-between gap-4 border-t border-border/70 py-5 text-xs text-muted-foreground"><span>Made for getting dressed, not getting judged.</span><span>SkinTune · 2025</span></footer>
  </div></div>;
}

function DressVisual({ dress, large = false }: { dress: DressResult; large?: boolean }) {
  return <div className={`relative overflow-hidden rounded-[1.4rem] bg-[#e4d6c4] ${large ? 'min-h-[390px]' : 'h-56'}`}>
    <img src={dress.imageUrl} alt={dress.title} className="size-full object-cover" loading="lazy" />
    <span className="absolute bottom-3 left-3 rounded-full bg-card/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-foreground backdrop-blur">{dress.siteName}</span>
  </div>;
}

// The real steps a dress search actually goes through — driven by genuine
// progress events from services/dress-search.ts (via lib/activity-log.ts),
// not a cosmetic timer. "Reading your profile" is the one synthetic step
// (marked done immediately, since there's no separate network call for
// it) so the checklist doesn't open on an empty first row; every other
// step's status reflects a real request boundary, and a failed step shows
// its own real error message rather than a generic one.
const SEARCH_STEPS = ['Reading your profile', 'Searching real stores', 'Building your results'];

function StepChecklist({ steps }: { steps: LogStep[] }) {
  return <div className="mt-16 max-w-md space-y-3" data-testid="list-generating-steps">
    {steps.map((step) => <div key={step.label} className="flex items-start gap-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full">
        {step.status === 'done' && <CheckCircle2 size={20} className="text-accent" />}
        {step.status === 'error' && <X size={20} className="text-destructive" />}
        {step.status === 'active' && <span className="relative grid size-5 place-items-center"><span className="absolute inset-0 animate-ping rounded-full bg-primary/40" /><span className="relative grid size-5 place-items-center rounded-full bg-primary"><RefreshCw size={11} className="animate-spin text-primary-foreground" /></span></span>}
        {step.status === 'pending' && <span className="size-2.5 rounded-full bg-border" />}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>{step.label}</p>
        {step.status === 'error' && step.detail && <p className="mt-0.5 text-xs text-destructive">{step.detail}</p>}
      </div>
    </div>)}
  </div>;
}

function Generating({ steps, error, onRetry, onBack }: { steps: LogStep[]; error: string; onRetry: () => void; onBack: () => void }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (error) return;
    const clockTimer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(clockTimer);
  }, [error]);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return <div className="noise min-h-[100dvh] bg-background text-foreground"><div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-center px-6 py-16">
    <div className="mb-14 flex items-center gap-2"><span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground"><Sparkles size={19} className="animate-pulse" /></span><span className="font-serif text-2xl">SkinTune</span></div>
    <p className="text-xs font-bold uppercase tracking-[.24em] text-primary">Your personal edit</p>
    <h1 className="mt-5 max-w-xl font-serif text-[clamp(3rem,8vw,6.5rem)] leading-[.88] tracking-[-.05em]">Making room<br />for your <em className="text-primary">point of view.</em></h1>
    <StepChecklist steps={steps} />
    {error ? <div className="mt-6 max-w-md animate-rise" data-testid="text-generating-error">
      <p className="text-sm font-semibold text-destructive">{error}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} data-testid="button-retry-search" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground"><RefreshCw size={15} /> Try again</button>
        <button type="button" onClick={onBack} data-testid="button-generating-back" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold hover:border-primary/50">Back</button>
      </div>
    </div> : <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={14} /> {elapsedSeconds < 3 ? 'Getting started…' : `${minutes > 0 ? `${minutes}m ` : ''}${seconds}s so far — check the browser console for full detail.`}</p>}
  </div></div>;
}

type SavedDress = { dress: DressResult; imageUrl: string };

function Home({ profile, savedDresses, onNew, onResults, onSettings, onQuickStart }: {
  profile: SkinTuneProfile; savedDresses: SavedDress[]; onNew: () => void; onResults: () => void;
  onSettings: () => void; onQuickStart: (occasion: string) => void;
}) {
  return <div className="noise min-h-[100dvh]"><Header onSettings={onSettings} name={profile.name} /><main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-16">
    <div className="grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
      <div className="animate-rise"><p className="text-xs font-bold uppercase tracking-[.22em] text-primary">How can SkinTune style you today?</p><h1 className="mt-4 max-w-2xl font-serif text-[clamp(3rem,7vw,6.2rem)] leading-[.88] tracking-[-.05em]">Good to see you,<br /><em className="text-primary">{profile.name}.</em></h1><p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Pick a moment to get dressed for, or pick up where you left off.</p>
        <div className="mt-7 flex flex-wrap gap-2">{homeOccasionShortcuts.map((item) => <button type="button" key={item.label} onClick={() => onQuickStart(item.label)} data-testid={`button-quickstart-${item.label.toLowerCase().replace(/\s+/g, '-')}`} className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-primary/50"><span aria-hidden>{item.icon}</span>{item.label}</button>)}</div>
        <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onResults} data-testid="button-view-looks" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-lg">Browse dresses for you <ArrowRight size={16} /></button><button type="button" onClick={onNew} data-testid="button-new-edit" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3.5 text-sm font-bold hover:border-primary/50"><RefreshCw size={16} /> New edit</button></div>
      </div>
      <div className="soft-grid relative overflow-hidden rounded-[1.7rem] border border-border bg-secondary/60 p-7"><div className="absolute -right-14 -top-14 size-48 rounded-full bg-primary/15 blur-2xl" /><p className="relative text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Your signature direction</p><h2 className="relative mt-3 font-serif text-3xl">Rich, considered, quietly luxe.</h2><div className="relative mt-7 flex items-end gap-2"><div className="h-20 w-12 rounded-t-full bg-[#c9a35c]" /><div className="h-28 w-12 rounded-t-full bg-[#1c1917]" /><div className="h-16 w-12 rounded-t-full bg-[#e8d5a3]" /><div className="h-24 w-12 rounded-t-full bg-[#8a6d3f]" /></div><p className="relative mt-6 text-sm leading-relaxed text-muted-foreground">Your saved palette leans into depth and gold, with room for one clear surprise.</p></div>
    </div>
    {savedDresses.length > 0 && <section className="mt-20"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Saved for later</p><h2 className="mt-2 font-serif text-3xl">Your keepers</h2></div><button type="button" onClick={onResults} data-testid="button-see-all-saved" className="focus-ring text-sm font-bold text-primary">See all <ArrowRight className="ml-1 inline" size={15} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{savedDresses.map((saved) => <a key={saved.dress.id} href={saved.dress.sourceUrl} target="_blank" rel="noreferrer" data-testid={`card-saved-look-${saved.dress.id}`} className="focus-ring rounded-[1.3rem] border border-border bg-card p-2 text-left transition hover:-translate-y-1"><div className="relative h-56 overflow-hidden rounded-[1.15rem] bg-[#e4d6c4]"><img src={saved.imageUrl} alt={saved.dress.title} className="size-full object-cover" loading="lazy" /></div><p className="px-3 pb-2 pt-3 font-serif text-xl">{saved.dress.title}</p></a>)}</div></section>}
  </main></div>;
}

function DressGrid({ profile, dresses, shopLinks, hasMore, loadingMore, loadMoreError, onViewDress, onLoadMore, onBack }: {
  profile: SkinTuneProfile; dresses: DressResult[]; shopLinks: ShopLink[]; hasMore: boolean; loadingMore: boolean; loadMoreError: string;
  onViewDress: (dress: DressResult) => void; onLoadMore: () => void; onBack: () => void;
}) {
  return <Shell profile={profile} onBack={onBack} onSettings={onBack}><div className="animate-rise">
    <div className="flex flex-wrap items-end justify-between gap-6"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">✨ Real Dresses For You</p><h1 className="mt-3 font-serif text-[clamp(2.8rem,6vw,5.4rem)] leading-[.9] tracking-[-.05em]">Pick one to<br /><em className="text-primary">try it on.</em></h1></div></div>
    <p className="mt-6 max-w-xl text-muted-foreground">Real pieces from real stores, matched to {profile.occasion.toLowerCase() || 'your moment'}. Tap any one to see the full piece before trying it on.</p>
    <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{dresses.map((dress) =>
      <article key={dress.id} className="group rounded-[1.45rem] border border-border bg-card p-2 shadow-[0_8px_30px_hsl(var(--foreground)/.04)]">
        <button type="button" onClick={() => onViewDress(dress)} data-testid={`card-dress-${dress.id}`} className="focus-ring block w-full text-left">
          <DressVisual dress={dress} />
          <div className="p-4 pb-3"><div className="flex items-start justify-between gap-3"><h2 className="min-w-0 font-serif text-xl leading-snug line-clamp-2">{dress.title}</h2><ChevronRight className="mt-1 shrink-0 text-muted-foreground transition group-hover:translate-x-1" size={20} /></div>
            <p className="mt-2 text-xs font-bold uppercase tracking-[.13em] text-primary">{dress.siteName}</p>
          </div>
        </button>
      </article>
    )}</div>
    {hasMore && <div className="mt-8 flex flex-col items-center gap-2">
      {loadMoreError && <p className="text-xs font-semibold text-destructive">{loadMoreError}</p>}
      <button type="button" onClick={onLoadMore} disabled={loadingMore} data-testid="button-load-more-dresses" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-bold hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60">{loadingMore ? <RefreshCw size={15} className="animate-spin" /> : <ChevronDown size={15} />} {loadingMore ? 'Finding more…' : 'More dresses'}</button>
    </div>}
    {shopLinks.length > 0 && <div className="mt-14"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Shop these online</p><h2 className="mt-2 font-serif text-3xl">More real stores worth a look.</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">{shopLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" data-testid={`link-shop-${link.siteName.toLowerCase()}`} className="focus-ring flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/45">
        <span className="min-w-0"><span className="block truncate font-semibold">{link.title}</span><span className="text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">{link.siteName}</span></span>
        {link.price && <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-bold">{link.price}</span>}
      </a>)}</div>
    </div>}
    <div className="mt-10 rounded-2xl border border-border bg-secondary/55 p-5 text-sm text-muted-foreground"><div className="flex items-start gap-3"><Info size={17} className="mt-0.5 shrink-0 text-primary" /><p>These are real, purchasable pieces found from real stores — availability, price, and sizing can change on the store's own site. "Try this on" shows a visualisation of you wearing it; always confirm details before buying.</p></div></div>
  </div></Shell>;
}

/**
 * Preview step between the grid and the actual try-on generation — added
 * per direct user request: tapping a card used to trigger try-on
 * immediately with no confirmation, which made it easy to accidentally
 * generate the wrong dress in a grid of similar-looking pieces (a real,
 * live-reported mismatch: the user believed they'd picked a black outfit
 * but the try-on came back on an ivory one — the most likely explanation
 * is an accidental click on a neighbouring card, since there was no
 * intermediate screen to catch it). This shows the dress full-size with
 * its real title/site before the (slow, ~2 minute) generation call runs,
 * so the user can visually confirm this is genuinely the piece they meant
 * before committing to it.
 */
function DressDetail({ dress, onBack, onTryOn }: {
  dress: DressResult; onBack: () => void; onTryOn: () => void;
}) {
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onBack} /><main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-14"><div className="grid gap-8 lg:grid-cols-[1fr_.85fr] lg:items-start">
    <div className="relative min-h-[420px] overflow-hidden rounded-[1.4rem] bg-[#e4d6c4]">
      <img src={dress.imageUrl} alt={dress.title} className="size-full object-cover" />
    </div>
    <div className="animate-rise lg:pt-4">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">{dress.siteName}</p>
      <h1 className="mt-4 font-serif text-[clamp(2.2rem,5vw,3.4rem)] leading-[.98] tracking-[-.03em]">{dress.title}</h1>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">A real piece from {dress.siteName}. Confirm this is the one you want, then try it on — this uses your uploaded photo and takes about a minute.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onTryOn} data-testid="button-confirm-try-on" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground"><Wand2 size={16} /> Try this on</button>
        <a href={dress.sourceUrl} target="_blank" rel="noreferrer" data-testid="button-visit-store" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold hover:border-primary/50">Visit {dress.siteName}</a>
      </div>
    </div>
  </div></main></div>;
}

function TryOn({ dress, profile, imageUrl, loading, error, saved, onSave, onBack, onTryAnother, onRetry }: {
  dress: DressResult; profile: SkinTuneProfile; imageUrl: string; loading: boolean; error: string; saved: boolean;
  onSave: () => void; onBack: () => void; onTryAnother: () => void; onRetry: () => void;
}) {
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onBack} /><main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-14"><div className="grid gap-8 lg:grid-cols-[1fr_.85fr] lg:items-start">
    <div>
      <div className="relative min-h-[420px] overflow-hidden rounded-[1.4rem] bg-[#e4d6c4]">
        {imageUrl ? <img src={imageUrl} alt={`You wearing ${dress.title}`} className="size-full object-cover" /> : <div className="absolute inset-0 grid place-items-center">
          {loading ? <div className="flex flex-col items-center gap-3 text-center" data-testid="text-try-on-loading"><span className="relative grid size-11 place-items-center"><span className="absolute inset-0 animate-ping rounded-full bg-primary/40" /><span className="relative grid size-11 place-items-center rounded-full bg-primary text-primary-foreground"><RefreshCw size={18} className="animate-spin" /></span></span><p className="max-w-[220px] text-sm font-semibold text-foreground/80">Trying this on for you…</p></div>
            : error ? <div className="flex flex-col items-center gap-3 px-6 text-center"><p className="text-sm font-semibold text-destructive">{error}</p><button type="button" onClick={onRetry} data-testid="button-retry-try-on" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"><RefreshCw size={15} /> Try again</button></div>
            : null}
        </div>}
      </div>
    </div>
    <div className="animate-rise lg:pt-4">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">{dress.siteName}</p>
      <h1 className="mt-4 font-serif text-[clamp(2.2rem,5vw,3.4rem)] leading-[.98] tracking-[-.03em]">{dress.title}</h1>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">A real piece from {dress.siteName}, shown on your own photo. Fit, fabric fall, and real-world colour may vary from the photo.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href={dress.sourceUrl} target="_blank" rel="noreferrer" data-testid="button-interested" className={`focus-ring inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold ${imageUrl ? 'bg-primary text-primary-foreground' : 'pointer-events-none bg-secondary text-muted-foreground'}`}><Heart size={16} /> Interested — visit {dress.siteName}</a>
        <button type="button" onClick={onTryAnother} data-testid="button-try-another" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold hover:border-primary/50"><X size={16} /> Not this one — try another</button>
      </div>
      {imageUrl && <button type="button" onClick={onSave} data-testid="button-save-tryon" className={`focus-ring mt-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold ${saved ? 'bg-secondary' : 'border border-border bg-card hover:border-primary/50'}`}>{saved ? <Check size={16} /> : <Save size={16} />} {saved ? 'Saved to your journal' : 'Save this'}</button>}
    </div>
  </div></main></div>;
}

function Settings({ profile, onBack, onDelete, deletedNotice }: { profile: SkinTuneProfile; onBack: () => void; onDelete: () => void; deletedNotice: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onBack} name={profile.name} /><main className="mx-auto max-w-2xl px-4 py-12 sm:px-8 sm:py-20">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Privacy, plainly</p>
    <h1 className="mt-4 font-serif text-5xl tracking-[-.04em]">Your space, your call.</h1>
    <p className="mt-5 leading-relaxed text-muted-foreground">SkinTune is a frontend prototype. Your profile and feedback live only in this browser's local storage. There is no account, server upload, or hidden score. SkinTune never makes medical or diagnostic claims.</p>
    <div className="mt-10 space-y-3">
      <div className="flex gap-4 rounded-2xl border border-border bg-card p-5"><LockKeyhole className="shrink-0 text-accent" /><div><p className="font-semibold">Photo privacy</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Your selected photo is used to show your preview in this browser. A future production version should use explicit retention controls before any upload.</p></div></div>
      <div className="flex gap-4 rounded-2xl border border-border bg-card p-5"><FileText className="shrink-0 text-primary" /><div><p className="font-semibold">What we remember</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Your choices, saved looks, and feedback stay available so returning to SkinTune feels continuous.</p></div></div>
    </div>
    <div className="mt-10 rounded-2xl border border-destructive/25 bg-destructive/5 p-5"><div className="flex items-start gap-4"><Trash2 className="mt-0.5 shrink-0 text-destructive" /><div className="flex-1"><p className="font-semibold">Delete my SkinTune data</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Remove your saved profile, photo preview, saved looks, and feedback from this browser.</p>
      {deletedNotice ? <p className="mt-4 flex items-center gap-2 text-sm font-bold text-accent"><CheckCircle2 size={16} /> Data deleted. Taking you back to the beginning…</p> : confirm ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onDelete} data-testid="button-confirm-delete" className="focus-ring rounded-full bg-destructive px-4 py-2.5 text-sm font-bold text-destructive-foreground">Yes, delete everything</button><button type="button" onClick={() => setConfirm(false)} data-testid="button-cancel-delete" className="focus-ring rounded-full bg-card px-4 py-2.5 text-sm font-bold">Keep my data</button></div> : <button type="button" onClick={() => setConfirm(true)} data-testid="button-delete-data" className="focus-ring mt-4 rounded-full border border-destructive/40 px-4 py-2.5 text-sm font-bold text-destructive hover:bg-destructive/10">Delete my data</button>}
    </div></div></div>
    <button type="button" onClick={onBack} data-testid="button-settings-done" className="focus-ring mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Back to my journal <ArrowRight size={16} /></button>
  </main></div>;
}

// ---------- Root app ----------

const DRESS_PAGE_SIZE = 10;

function SkinTune() {
  const [screen, setScreen] = useState<Screen>(() => localStorage.getItem('skintune-profile') ? 'home' : 'welcome');
  const [profile, setProfile] = useState<SkinTuneProfile>(() => { try { return { ...initialProfile, ...JSON.parse(localStorage.getItem('skintune-profile') || '{}') }; } catch { return initialProfile; } });
  const [savedDresses, setSavedDresses] = useState<SavedDress[]>(() => { try { return JSON.parse(localStorage.getItem('skintune-saved-looks') || '[]'); } catch { return []; } });
  const [deletedNotice, setDeletedNotice] = useState(false);

  // Real-dress-search state: the current page of results, "shop these
  // online" links (fetched once alongside the first page), whether another
  // page is worth loading, and the dress currently being tried on.
  const [dresses, setDresses] = useState<DressResult[]>([]);
  const [shopLinks, setShopLinks] = useState<ShopLink[]>([]);
  const [hasMoreDresses, setHasMoreDresses] = useState(false);
  const [loadingMoreDresses, setLoadingMoreDresses] = useState(false);
  const [selectedDress, setSelectedDress] = useState<DressResult | null>(null);
  const [tryOnImageUrl, setTryOnImageUrl] = useState('');
  const [tryOnLoading, setTryOnLoading] = useState(false);
  const [tryOnError, setTryOnError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [searchSteps, setSearchSteps] = useState<LogStep[]>(() => SEARCH_STEPS.map((label) => ({ label, status: 'pending' })));
  const [loadMoreError, setLoadMoreError] = useState('');

  const update = (patch: Partial<SkinTuneProfile>) => setProfile((old) => ({ ...old, ...patch }));
  const index = wizardScreens.indexOf(screen);
  const go = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const back = () => { if (screen === 'try-on') go('dress-detail'); else if (screen === 'dress-detail') go('dresses'); else if (index > 0) go(wizardScreens[index - 1]); else go(profile.name ? 'home' : 'welcome'); };
  const saveProfile = () => { localStorage.setItem('skintune-profile', JSON.stringify(profile)); go('generating'); };
  const openSettings = () => go(profile.name ? 'settings' : 'welcome');

  const viewDress = (dress: DressResult) => {
    setSelectedDress(dress);
    go('dress-detail');
  };

  const runTryOn = (dress: DressResult) => {
    setSelectedDress(dress);
    setTryOnImageUrl('');
    setTryOnError('');
    setTryOnLoading(true);
    go('try-on');
    console.log(`[SkinTune] Starting try-on: "${dress.title}" from ${dress.siteName}`);
    tryOnDress(dress, profile)
      .then((imageUrl) => { console.log('[SkinTune] Try-on complete.'); setTryOnImageUrl(imageUrl); })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[SkinTune] Try-on failed:', detail);
        setTryOnError(detail);
      })
      .finally(() => setTryOnLoading(false));
  };

  useEffect(() => {
    if (screen !== 'generating') return;
    let active = true;
    setSearchError('');
    setSearchSteps(SEARCH_STEPS.map((label) => ({ label, status: 'pending' })));
    const log = createActivityLog(SEARCH_STEPS, (steps) => { if (active) setSearchSteps(steps); });
    console.log('[SkinTune] Starting dress search for profile:', profile.occasion || '(no occasion)', profile.style);
    log.start('Reading your profile');
    log.done('Reading your profile'); // synthetic — no separate network call, just marks the checklist's first row complete immediately
    searchDresses(profile, 0, DRESS_PAGE_SIZE, log)
      .then((page) => {
        if (!active) return;
        console.log(`[SkinTune] Search complete: ${page.results.length} dresses, ${page.shopLinks.length} shop links, hasMore=${page.hasMore}`);
        setDresses(page.results);
        setShopLinks(page.shopLinks);
        setHasMoreDresses(page.hasMore);
        go('dresses');
      })
      .catch((err) => {
        if (!active) return;
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[SkinTune] Dress search failed:', detail);
        setSearchError(detail);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: search begins once per entry into this screen (searchAttempt bumps to retry)
  }, [screen, searchAttempt]);

  useEffect(() => { localStorage.setItem('skintune-saved-looks', JSON.stringify(savedDresses)); }, [savedDresses]);

  const isDressSaved = (dressId: string) => savedDresses.some((item) => item.dress.id === dressId);

  if (screen === 'welcome') return <Welcome onStart={() => go('name')} onPrivacy={() => go('settings')} />;
  if (screen === 'home') return <Home profile={profile} savedDresses={savedDresses} onNew={() => { update({ photoUrl: '' }); go('name'); }} onResults={() => go(dresses.length ? 'dresses' : 'generating')} onSettings={openSettings} onQuickStart={(occasion) => { update({ occasion }); go('final-prefs'); }} />;
  if (screen === 'settings') return <Settings profile={profile} deletedNotice={deletedNotice} onBack={() => go(profile.name ? 'home' : 'welcome')} onDelete={() => { localStorage.removeItem('skintune-profile'); localStorage.removeItem('skintune-saved-looks'); localStorage.removeItem('skintune-feedback'); setProfile(initialProfile); setDeletedNotice(true); setTimeout(() => go('welcome'), 900); }} />;
  if (screen === 'photo') return <PhotoPanel profile={profile} update={update} onContinue={() => go('appearance')} onBack={back} />;
  if (screen === 'dresses') return <DressGrid profile={profile} dresses={dresses} shopLinks={shopLinks} hasMore={hasMoreDresses} loadingMore={loadingMoreDresses} loadMoreError={loadMoreError} onViewDress={viewDress} onLoadMore={() => {
    setLoadingMoreDresses(true);
    setLoadMoreError('');
    searchDresses(profile, dresses.length, DRESS_PAGE_SIZE)
      .then((page) => { setDresses((old) => [...old, ...page.results]); setHasMoreDresses(page.hasMore); })
      .catch((err) => { const detail = err instanceof Error ? err.message : String(err); console.error('[SkinTune] Load more dresses failed:', detail); setLoadMoreError(detail); })
      .finally(() => setLoadingMoreDresses(false));
  }} onBack={() => go('home')} />;
  if (screen === 'dress-detail' && selectedDress) return <DressDetail dress={selectedDress} onBack={back} onTryOn={() => runTryOn(selectedDress)} />;
  if (screen === 'try-on' && selectedDress) return <TryOn dress={selectedDress} profile={profile} imageUrl={tryOnImageUrl} loading={tryOnLoading} error={tryOnError} saved={isDressSaved(selectedDress.id)} onSave={() => setSavedDresses((old) => isDressSaved(selectedDress.id) ? old.filter((item) => item.dress.id !== selectedDress.id) : [...old, { dress: selectedDress, imageUrl: tryOnImageUrl }])} onBack={back} onTryAnother={() => go('dresses')} onRetry={() => runTryOn(selectedDress)} />;
  if (screen === 'generating') return <Generating steps={searchSteps} error={searchError} onRetry={() => setSearchAttempt((v) => v + 1)} onBack={() => go(profile.name ? 'home' : 'welcome')} />;

  const screenContent: Record<string, ReactNode> = {
    name: <NameStep profile={profile} update={update} onNext={() => go('profile')} onBack={back} />,
    profile: <SingleChoiceStep profile={profile} update={update} field="pronouns" step={2} eyebrow="02 / a little context" title="How should we write your styling advice?" body="Choose the language and point of view that feels most like you." options={pronounOptions} onNext={() => go('age')} onBack={back} />,
    age: <SingleChoiceStep profile={profile} update={update} field="ageGroup" step={3} eyebrow="03 / a little context" title="Which age range feels right?" body="This helps us tune proportions and references. There's no wrong answer." options={ageGroupOptions} onNext={() => go('height')} onBack={back} />,
    height: <HeightStep profile={profile} update={update} step={4} eyebrow="04 / a little context" title="What's your height?" body="Optional — helps us tune proportion suggestions." onNext={() => go('consent')} onBack={back} />,
    consent: <ConsentStep profile={profile} onNext={() => go('photo')} onBack={back} />,
    appearance: <AppearanceStep profile={profile} onNext={() => go('body-style')} onPhoto={() => go('photo')} onBack={back} />,
    'body-style': <SectionStep profile={profile} update={update} step={8} eyebrow="08 / your canvas" title="Your build, fit, and style." body="A few quick checkboxes — pick what fits, and we'll get moving."
      fields={[
        { kind: 'single', field: 'bodyBuild', label: 'How would you describe your build?', options: bodyBuildOptions },
        { kind: 'single', field: 'fit', label: 'What fit feels like you?', options: fitOptions },
        { kind: 'multi', field: 'style', label: 'Which style worlds pull you in?', hint: 'Choose as many as you like.', options: styleOptions },
      ]}
      onNext={() => go('colors-occasion')} onBack={back} />,
    'colors-occasion': <SectionStep profile={profile} update={update} step={9} eyebrow="09 / colours & the moment" title="Colour, comfort, and where you're headed." body="Everything you need for this look, in one go."
      fields={[
        { kind: 'multi', field: 'colorsLove', label: 'Which colors do you reach for?', options: colorLoveOptions, max: 5 },
        { kind: 'multi', field: 'colorsAvoid', label: 'Anything you tend to avoid?', options: colorAvoidOptions, required: false },
        { kind: 'multi', field: 'restrictions', label: 'Anything we should work around?', options: restrictionOptions, required: false },
        { kind: 'single', field: 'occasion', label: 'Where are you getting dressed for?', options: occasionOptions },
      ]}
      onNext={() => go('final-prefs')} onBack={back} />,
    'final-prefs': <SectionStep profile={profile} update={update} step={10} eyebrow="10 / the finishing touch" title="How you want to come across, and your budget." body="Last section — then we'll make your five looks."
      fields={[
        { kind: 'multi', field: 'impression', label: 'How do you want to come across?', options: impressionOptions, max: 2 },
        { kind: 'single', field: 'budget', label: 'What feels comfortable for this edit?', options: budgetOptions },
      ]}
      continueLabel="Review my edit"
      onNext={() => go('review')} onBack={back} />,
    review: <Review profile={profile} onEdit={(target) => go(target)} onSave={saveProfile} onBack={back} />,
  };
  return <>{screenContent[screen]}</>;
}

function Review({ profile, onEdit, onSave, onBack }: { profile: SkinTuneProfile; onEdit: (s: Screen) => void; onSave: () => void; onBack: () => void }) {
  const rows: { label: string; value: string; target: Screen }[] = [
    { label: 'Appearance', value: `${profile.appearance.skinTone} · ${profile.appearance.undertone} undertone · ${profile.appearance.confidence}% confidence`, target: 'appearance' },
    { label: 'Profile', value: `${profile.pronouns} · ${profile.ageGroup}`, target: 'profile' },
    { label: 'Build, fit & style', value: `${profile.bodyBuild} · ${profile.fit}${profile.style.length ? ` · ${profile.style.join(', ')}` : ''}`, target: 'body-style' },
    { label: 'Colours & moment', value: `Loves ${profile.colorsLove.join(', ')}${profile.colorsAvoid.length ? ` · avoids ${profile.colorsAvoid.join(', ')}` : ''} · ${profile.occasion}`, target: 'colors-occasion' },
    { label: 'Impression & budget', value: `${profile.impression.join(', ')} · ${profile.budget}`, target: 'final-prefs' },
  ];
  return <StepShell profile={profile} onBack={onBack} step={11}><Intro eyebrow="11 / your edit, at a glance" title={`This sounds like ${profile.name}.`} body="Look it over, make any changes, then we'll search real stores for pieces that match.">
    <div className="divide-y divide-border overflow-hidden rounded-[1.5rem] border border-border bg-card">{rows.map((row) => <div key={row.label} className="flex items-start justify-between gap-4 p-5"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">{row.label}</p><p className="mt-1 line-clamp-2 text-sm leading-relaxed">{row.value}</p></div><button type="button" onClick={() => onEdit(row.target)} data-testid={`button-edit-${row.label.toLowerCase().replace(' ', '-')}`} className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-primary hover:bg-secondary"><Pencil size={13} /> Edit</button></div>)}</div>
    <FooterActions onBack={onBack} onContinue={onSave} label="✨ Find my dresses" />
  </Intro></StepShell>;
}

function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary resetKey="skintune"><SkinTune /></ErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider>; }

export default App;
