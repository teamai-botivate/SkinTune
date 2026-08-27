import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, Clock3, FileText, Heart, Info, LockKeyhole, Pencil, RefreshCw,
  RotateCcw, Save, ShieldCheck, Sparkles, Trash2, Upload, X, SlidersHorizontal,
} from 'lucide-react';
import { getLookRecommendations } from './services/recommendation-engine';
import { generateLookImages } from './services/image-generation';
import { photoAnalysisStages, photoDiagnostics } from './data/photo-diagnostics';
import {
  ageGroupOptions, bodyBuildOptions, budgetOptions, colorAvoidOptions, colorLoveOptions,
  feedbackChangeOptions, feedbackFeelingOptions, fitOptions, homeOccasionShortcuts,
  impressionOptions, lookCategoryBadges, occasionOptions, priorityOptions, pronounOptions,
  restrictionOptions, styleOptions, type SelectOption,
} from './data/options';
import type { LookRecommendation, PhotoStatus, SkinTuneProfile } from './types';

const queryClient = new QueryClient();

type Screen =
  | 'welcome' | 'home' | 'name' | 'profile' | 'age' | 'height' | 'consent' | 'photo' | 'appearance'
  | 'body' | 'fit' | 'priorities' | 'style' | 'colors' | 'colors-avoid' | 'restrictions'
  | 'occasion' | 'context' | 'impression' | 'budget' | 'review' | 'generating' | 'results'
  | 'detail' | 'feedback' | 'settings';

const initialProfile: SkinTuneProfile = {
  name: '', pronouns: '', ageGroup: '', height: '', photoUrl: '', bodyBuild: '',
  appearance: { skinTone: '', undertone: '', confidence: 0, contrast: 'Medium' },
  fit: [], priorities: [], style: [], colorsLove: [], colorsAvoid: [], restrictions: [],
  occasion: '', occasionDetails: '', impression: [], budget: '',
};

const wizardScreens: Screen[] = [
  'name', 'profile', 'age', 'height', 'consent', 'photo', 'appearance', 'body', 'fit',
  'priorities', 'style', 'colors', 'colors-avoid', 'restrictions', 'occasion', 'context',
  'impression', 'budget', 'review',
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

function ContextStep({ profile, update, onNext, onBack }: { profile: SkinTuneProfile; update: (p: Partial<SkinTuneProfile>) => void; onNext: () => void; onBack: () => void }) {
  return <StepShell profile={profile} onBack={onBack} step={16}><Intro eyebrow="16 / set the scene" title="Give us the useful details." body="A sentence is plenty. Think weather, venue, dress code, and anything you want to feel in the room."><textarea autoFocus value={profile.occasionDetails} onChange={(e) => update({ occasionDetails: e.target.value })} data-testid="textarea-occasion-details" rows={5} placeholder="It’s a late-spring dinner at a small restaurant. I want to look considered but not overdressed." className="focus-ring w-full resize-none rounded-2xl border border-border bg-card p-5 leading-relaxed outline-none placeholder:text-muted-foreground/55" /><FooterActions onBack={onBack} onContinue={onNext} disabled={!profile.occasionDetails.trim()} /></Intro></StepShell>;
}

// ---------- Photo analysis ----------

function PhotoPanel({ profile, update, onContinue, onBack }: { profile: SkinTuneProfile; update: (p: Partial<SkinTuneProfile>) => void; onContinue: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<PhotoStatus>(profile.appearance.confidence ? 'good' : 'low-confidence');
  const [analyzing, setAnalyzing] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const diagnostic = photoDiagnostics[status];

  const runAnalysis = (nextStatus: PhotoStatus = 'good') => {
    setAnalyzing(true);
    setStageIndex(0);
    const stepMs = 550;
    photoAnalysisStages.forEach((_, i) => {
      window.setTimeout(() => setStageIndex(i), stepMs * i);
    });
    window.setTimeout(() => {
      setAnalyzing(false);
      setStatus(nextStatus);
      if (nextStatus === 'good') {
        update({ appearance: { skinTone: 'Medium', undertone: 'Warm', confidence: 94, contrast: 'Medium' } });
      }
    }, stepMs * photoAnalysisStages.length + 300);
  };

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      update({ photoUrl: String(reader.result) });
      runAnalysis('good');
    };
    reader.readAsDataURL(file);
  };

  const retry = () => {
    update({ photoUrl: '' });
    setStatus('low-confidence');
  };

  return <Shell profile={profile} onBack={onBack} onSettings={onBack} step={6} total={WIZARD_TOTAL}><div className="mx-auto max-w-3xl"><Intro eyebrow="06 / a gentle check" title="A photo helps us notice the details." body="This is only used to tune color and proportion suggestions. It is not a beauty score, identity check, or medical assessment.">
    <div className="mt-8 grid gap-6 md:grid-cols-[.84fr_1.16fr]">
      <div className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[1.5rem] border border-border bg-secondary/60 p-6">
        {profile.photoUrl ? <img src={profile.photoUrl} alt="Your uploaded portrait" data-testid="img-upload-preview" className="absolute inset-0 size-full object-cover" /> : <><div className="grid size-24 place-items-center rounded-full bg-card text-primary"><Camera size={34} /></div><p className="mt-4 text-center text-sm font-semibold">A natural, shoulders-up photo</p><p className="mt-1 text-center text-xs text-muted-foreground">No posing required.</p></>}
        <label className="focus-ring absolute bottom-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-bold shadow-lg"><Upload size={15} /> {profile.photoUrl ? 'Choose another' : 'Choose a photo'}<input type="file" accept="image/*" onChange={pickFile} data-testid="input-photo" className="sr-only" /></label>
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
      <div className="relative mx-auto aspect-square w-full max-w-[470px] animate-floaty"><div className="absolute inset-[8%] rounded-[45%_55%_49%_51%/42%_43%_57%_58%] bg-secondary/80" /><div className="absolute inset-[17%] rounded-[52%_48%_42%_58%/54%_43%_57%_46%] border border-primary/20 bg-[#e8b493]" /><div className="absolute left-[31%] top-[28%] h-[45%] w-[39%] rounded-[45%_55%_48%_52%/40%_38%_62%_60%] bg-[#6d4038] shadow-[12px_22px_0_#cb7e61]" /><div className="absolute bottom-[19%] left-[22%] right-[20%] h-[26%] rounded-t-[50%] bg-accent" /><div className="absolute bottom-[12%] left-[31%] h-[10%] w-[37%] rounded-full bg-primary/85" /><div className="absolute -right-3 top-[17%] rounded-2xl border border-border bg-card px-4 py-3 shadow-xl"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Your palette</p><div className="mt-2 flex gap-1.5"><i className="size-5 rounded-full bg-[#d58e6e]" /><i className="size-5 rounded-full bg-[#253b3b]" /><i className="size-5 rounded-full bg-[#e5c99f]" /><i className="size-5 rounded-full bg-[#a84f3c]" /></div></div><div className="absolute -bottom-1 -left-3 max-w-[180px] rounded-2xl border border-border bg-card px-4 py-3 shadow-xl"><p className="text-sm font-semibold leading-tight">Not a score.<br /><span className="text-primary">A point of view.</span></p></div></div>
    </div>
    <footer className="flex flex-wrap justify-between gap-4 border-t border-border/70 py-5 text-xs text-muted-foreground"><span>Made for getting dressed, not getting judged.</span><span>SkinTune · 2025</span></footer>
  </div></div>;
}

function LookVisual({ look, large = false }: { look: LookRecommendation; large?: boolean }) {
  return <div className={`relative overflow-hidden rounded-[1.4rem] bg-[#e4d6c4] ${large ? 'min-h-[390px]' : 'h-56'}`} data-image-url={look.imageUrl} aria-label={`${look.title} visual placeholder`}>
    <div className="absolute inset-0 opacity-75" style={{ background: `radial-gradient(circle at 68% 21%, ${look.palette[1]} 0 8%, transparent 8.5%), linear-gradient(145deg, ${look.palette[2]} 0 38%, ${look.palette[0]} 38% 70%, #b78668 70%)` }} />
    <div className="absolute bottom-[-8%] left-[23%] h-[82%] w-[55%] rounded-t-[48%] bg-card/70 mix-blend-screen" />
    <div className="absolute left-[39%] top-[16%] size-[22%] rounded-full bg-[#b7785c]" />
    <div className="absolute bottom-[15%] left-1/2 h-[42%] w-[20%] -translate-x-1/2 rounded-[45%] bg-card/55" />
    <span className="absolute bottom-3 left-3 rounded-full bg-card/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-foreground backdrop-blur">Style visualisation · image slot</span>
  </div>;
}

function Generating() {
  const stages = ['Reading the room', 'Balancing your palette', 'Building complete outfits', 'Adding the details that make them yours'];
  const [active, setActive] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setActive((value) => Math.min(value + 1, 3)), 640); return () => window.clearInterval(timer); }, []);
  return <div className="noise min-h-[100dvh] bg-[#273e3b] text-[#f7eddf]"><div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-center px-6 py-16"><div className="mb-14 flex items-center gap-2"><span className="grid size-10 place-items-center rounded-[14px] bg-[#dc7456]"><Sparkles size={19} /></span><span className="font-serif text-2xl">SkinTune</span></div><p className="text-xs font-bold uppercase tracking-[.24em] text-[#efad87]">Your personal edit</p><h1 className="mt-5 max-w-xl font-serif text-[clamp(3rem,8vw,6.5rem)] leading-[.88] tracking-[-.05em]">Making room<br />for your <em className="text-[#efad87]">point of view.</em></h1><div className="mt-16 max-w-md space-y-4">{stages.map((stage, index) => <div key={stage} className={`flex items-center gap-4 transition duration-500 ${index <= active ? 'opacity-100' : 'opacity-30'}`}><span className={`grid size-8 place-items-center rounded-full border ${index < active ? 'border-[#efad87] bg-[#efad87] text-[#273e3b]' : 'border-[#f7eddf]/40'}`}>{index < active ? <Check size={15} /> : index === active ? <span className="size-2 animate-pulse rounded-full bg-[#efad87]" /> : <span className="size-1.5 rounded-full bg-[#f7eddf]/50" />}</span><span className="text-sm font-semibold">{stage}</span></div>)}</div><p className="mt-12 flex items-center gap-2 text-xs text-[#f7eddf]/65"><Clock3 size={14} /> Usually takes less than a minute</p></div></div>;
}

function Home({ profile, savedLooks, generatedLooks, onNew, onResults, onSettings, onLook, onQuickStart }: {
  profile: SkinTuneProfile; savedLooks: string[]; generatedLooks: LookRecommendation[]; onNew: () => void; onResults: () => void;
  onSettings: () => void; onLook: (id: string) => void; onQuickStart: (occasion: string) => void;
}) {
  return <div className="noise min-h-[100dvh]"><Header onSettings={onSettings} name={profile.name} /><main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-16">
    <div className="grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
      <div className="animate-rise"><p className="text-xs font-bold uppercase tracking-[.22em] text-primary">How can SkinTune style you today?</p><h1 className="mt-4 max-w-2xl font-serif text-[clamp(3rem,7vw,6.2rem)] leading-[.88] tracking-[-.05em]">Good to see you,<br /><em className="text-primary">{profile.name}.</em></h1><p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">Pick a moment to get dressed for, or pick up where you left off.</p>
        <div className="mt-7 flex flex-wrap gap-2">{homeOccasionShortcuts.map((item) => <button type="button" key={item.label} onClick={() => onQuickStart(item.label)} data-testid={`button-quickstart-${item.label.toLowerCase().replace(/\s+/g, '-')}`} className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-primary/50"><span aria-hidden>{item.icon}</span>{item.label}</button>)}</div>
        <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onResults} data-testid="button-view-looks" className="focus-ring inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-lg">View your five looks <ArrowRight size={16} /></button><button type="button" onClick={onNew} data-testid="button-new-edit" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3.5 text-sm font-bold hover:border-primary/50"><RefreshCw size={16} /> New edit</button></div>
      </div>
      <div className="soft-grid relative overflow-hidden rounded-[1.7rem] border border-border bg-secondary/60 p-7"><div className="absolute -right-14 -top-14 size-48 rounded-full bg-primary/15 blur-2xl" /><p className="relative text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Your signature direction</p><h2 className="relative mt-3 font-serif text-3xl">Warm, considered, quietly magnetic.</h2><div className="relative mt-7 flex items-end gap-2"><div className="h-20 w-12 rounded-t-full bg-[#d58e6e]" /><div className="h-28 w-12 rounded-t-full bg-[#283d3b]" /><div className="h-16 w-12 rounded-t-full bg-[#e5c99f]" /><div className="h-24 w-12 rounded-t-full bg-[#a84f3c]" /></div><p className="relative mt-6 text-sm leading-relaxed text-muted-foreground">Your saved palette leans into warmth and depth, with room for one clear surprise.</p></div>
    </div>
    {savedLooks.length > 0 && <section className="mt-20"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Saved for later</p><h2 className="mt-2 font-serif text-3xl">Your keepers</h2></div><button type="button" onClick={onResults} data-testid="button-see-all-saved" className="focus-ring text-sm font-bold text-primary">See all <ArrowRight className="ml-1 inline" size={15} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{savedLooks.map((id) => { const look = generatedLooks.find((item) => item.id === id); return look && <button type="button" key={id} onClick={() => onLook(id)} data-testid={`card-saved-look-${id}`} className="focus-ring rounded-[1.3rem] border border-border bg-card p-2 text-left transition hover:-translate-y-1"><LookVisual look={look} /><p className="px-3 pb-2 pt-3 font-serif text-xl">{look.title}</p></button>; })}</div></section>}
  </main></div>;
}

function Results({ profile, looks: resultLooks, savedLooks, onSave, onLook, onFeedback, onBack }: { profile: SkinTuneProfile; looks: LookRecommendation[]; savedLooks: string[]; onSave: (id: string) => void; onLook: (id: string) => void; onFeedback: () => void; onBack: () => void }) {
  return <Shell profile={profile} onBack={onBack} onSettings={onBack}><div className="animate-rise">
    <div className="flex flex-wrap items-end justify-between gap-6"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">✨ Your 5 Best Looks</p><h1 className="mt-3 font-serif text-[clamp(2.8rem,6vw,5.4rem)] leading-[.9] tracking-[-.05em]">A wardrobe of<br /><em className="text-primary">possibilities.</em></h1></div><button type="button" onClick={onFeedback} data-testid="button-request-changes" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-bold hover:border-primary/50"><SlidersHorizontal size={16} /> Change the direction</button></div>
    <p className="mt-6 max-w-xl text-muted-foreground">Built for {profile.occasion.toLowerCase() || 'your moment'} with a {profile.impression.join(' and ').toLowerCase() || 'considered'} energy. Nothing here is a rule — just five places to begin.</p>
    <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{resultLooks.map((look, index) => {
      const badge = lookCategoryBadges[index] ?? lookCategoryBadges[lookCategoryBadges.length - 1];
      return <article key={look.id} className={`group rounded-[1.45rem] border border-border bg-card p-2 shadow-[0_8px_30px_hsl(var(--foreground)/.04)] ${index === 0 ? 'md:col-span-2 lg:col-span-2' : ''}`}>
        <button type="button" onClick={() => onLook(look.id)} data-testid={`card-look-${look.id}`} className="focus-ring block w-full text-left">
          <LookVisual look={look} large={index === 0} />
          <div className="p-4 pb-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-primary">{badge.icon} {badge.label}</p><h2 className="mt-1 font-serif text-2xl">{look.title}</h2></div><ChevronRight className="mt-2 text-muted-foreground transition group-hover:translate-x-1" size={20} /></div>
            <p className="mt-2 text-sm text-muted-foreground">{look.note}</p>
            <dl className="mt-5 grid gap-x-4 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-2">
              <div><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Outfit</dt><dd className="mt-1 text-sm leading-snug">{look.outfit}</dd></div>
              <div><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Jewellery</dt><dd className="mt-1 text-sm leading-snug">{look.jewellery}</dd></div>
              <div><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Hairstyle</dt><dd className="mt-1 text-sm leading-snug">{look.hairstyle}</dd></div>
              <div><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Makeup</dt><dd className="mt-1 text-sm leading-snug">{look.makeup}</dd></div>
            </dl>
          </div>
        </button>
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-3"><span className="flex items-center gap-2"><span className="flex gap-1.5">{look.palette.map((color) => <i key={color} className="size-4 rounded-full border border-card shadow-sm" style={{ backgroundColor: color }} />)}</span><span className="text-xs font-semibold text-muted-foreground">{look.confidence}% confidence</span></span><button type="button" onClick={() => onSave(look.id)} data-testid={`button-save-${look.id}`} className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${savedLooks.includes(look.id) ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{savedLooks.includes(look.id) ? <Check size={14} /> : <Heart size={14} />} {savedLooks.includes(look.id) ? 'Saved' : 'Save'}</button></div>
      </article>;
    })}</div>
    <div className="mt-10 rounded-2xl border border-border bg-secondary/55 p-5 text-sm text-muted-foreground"><div className="flex items-start gap-3"><Info size={17} className="mt-0.5 shrink-0 text-primary" /><p>Style visualisation — actual fit, fabric fall and real-world colour may vary. These looks are starting points shaped around your answers; keep what feels like you, skip what doesn’t, and tell us what to change.</p></div></div>
  </div></Shell>;
}

function LookDetail({ look, saved, onSave, onBack, onFeedback }: { look: LookRecommendation; saved: boolean; onSave: () => void; onBack: () => void; onFeedback: () => void }) {
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onBack} /><main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-14"><div className="grid gap-8 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
    <LookVisual look={look} large />
    <div className="animate-rise lg:pt-4">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">The complete look</p>
      <h1 className="mt-4 font-serif text-[clamp(3rem,7vw,6rem)] leading-[.86] tracking-[-.05em]">{look.title}</h1>
      <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">{look.note}</p>
      <div className="mt-7 flex items-center gap-3"><div className="flex gap-2">{look.palette.map((color) => <span key={color} className="size-8 rounded-full border-2 border-card shadow-sm" style={{ backgroundColor: color }} />)}</div><span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold">{look.confidence}% confidence</span></div>
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">👗 Outfit</p><p className="mt-2 font-semibold">{look.outfit}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">🎨 Colour</p><p className="mt-2 font-semibold">{look.outfitColor}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">💎 Jewellery</p><p className="mt-2 font-semibold">{look.jewellery}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">💇 Hairstyle</p><p className="mt-2 font-semibold">{look.hairstyle}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">💄 Makeup</p><p className="mt-2 font-semibold">{look.makeup}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">👠 Footwear</p><p className="mt-2 font-semibold">{look.footwear}</p></div>
        <div className="rounded-2xl border border-border bg-card p-4 sm:col-span-2"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">👜 Accessories</p><p className="mt-2 font-semibold">{look.accessories}</p></div>
      </div>
      <div className="mt-8 rounded-2xl border border-accent/25 bg-accent/7 p-5"><p className="font-serif text-2xl">Why SkinTune chose this</p><ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">{look.reasoning.map((reason) => <li key={reason} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-accent" /> {reason}</li>)}</ul></div>
      <div className="mt-6 divide-y divide-border border-y border-border">{look.pieces.map((piece) => <div key={piece.category} className="grid grid-cols-[72px_1fr] gap-4 py-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{piece.category}</p><div><p className="font-semibold">{piece.name}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{piece.detail}</p></div></div>)}</div>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Style visualisation — actual fit, fabric fall and real-world colour may vary.</p>
      <div className="mt-8 flex flex-wrap gap-3"><button type="button" onClick={onSave} data-testid="button-detail-save" className={`focus-ring inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold ${saved ? 'bg-secondary' : 'bg-primary text-primary-foreground'}`}>{saved ? <Check size={16} /> : <Save size={16} />} {saved ? 'Saved to your journal' : 'Save this look'}</button><button type="button" onClick={onFeedback} data-testid="button-detail-not-for-me" className="focus-ring inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold hover:border-primary/50"><X size={16} /> Not my style</button></div>
    </div>
  </div></main></div>;
}

function Feedback({ feeling, setFeeling, changeAreas, toggleChangeArea, request, setRequest, onBack, onDone }: {
  feeling: string; setFeeling: (v: string) => void; changeAreas: string[]; toggleChangeArea: (v: string) => void;
  request: string; setRequest: (v: string) => void; onBack: () => void; onDone: () => void;
}) {
  const notMyStyle = feeling === 'Not my style';
  return <div className="noise min-h-[100dvh]"><Header onBack={onBack} onSettings={onBack} /><main className="mx-auto max-w-2xl px-4 py-12 sm:px-8 sm:py-20"><Intro eyebrow="A better next edit" title="How did this land?" body="Your honest reaction helps us keep your taste at the center.">
    <div className="grid gap-3 sm:grid-cols-2">{feedbackFeelingOptions.map((item) => <OptionCard key={item.label} label={item.label} icon={item.icon} selected={feeling === item.label} onClick={() => setFeeling(feeling === item.label ? '' : item.label)} />)}</div>
    {notMyStyle && <div className="mt-8 animate-rise" data-testid="panel-what-to-change"><p className="mb-3 text-sm font-bold">What should we change?</p><div className="grid gap-3 sm:grid-cols-2">{feedbackChangeOptions.map((item) => <OptionCard key={item.label} label={item.label} icon={item.icon} selected={changeAreas.includes(item.label)} onClick={() => toggleChangeArea(item.label)} />)}</div></div>}
    <label className="mt-7 block"><span className="mb-2 block text-sm font-bold">Anything else? <span className="font-normal text-muted-foreground">optional</span></span><textarea value={request} onChange={(e) => setRequest(e.target.value)} data-testid="textarea-change-request" rows={4} placeholder="More relaxed, fewer layers, a little brighter…" className="focus-ring w-full resize-none rounded-2xl border border-border bg-card p-4 outline-none placeholder:text-muted-foreground/55" /></label>
    <FooterActions onBack={onBack} onContinue={onDone} disabled={!feeling} label={notMyStyle ? '🔄 Create New Looks' : 'Save feedback'} />
  </Intro></main></div>;
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

function SkinTune() {
  const [screen, setScreen] = useState<Screen>(() => localStorage.getItem('skintune-profile') ? 'home' : 'welcome');
  const [profile, setProfile] = useState<SkinTuneProfile>(() => { try { return { ...initialProfile, ...JSON.parse(localStorage.getItem('skintune-profile') || '{}') }; } catch { return initialProfile; } });
  const [detailId, setDetailId] = useState('look-01');
  const [savedLooks, setSavedLooks] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('skintune-saved-looks') || '[]'); } catch { return []; } });
  const [feeling, setFeeling] = useState('');
  const [changeAreas, setChangeAreas] = useState<string[]>([]);
  const [changeRequest, setChangeRequest] = useState('');
  const [generatedLooks, setGeneratedLooks] = useState<LookRecommendation[]>([]);
  const [deletedNotice, setDeletedNotice] = useState(false);

  const update = (patch: Partial<SkinTuneProfile>) => setProfile((old) => ({ ...old, ...patch }));
  const index = wizardScreens.indexOf(screen);
  const go = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const back = () => { if (screen === 'detail' || screen === 'feedback') go('results'); else if (index > 0) go(wizardScreens[index - 1]); else go(profile.name ? 'home' : 'welcome'); };
  const saveProfile = () => { localStorage.setItem('skintune-profile', JSON.stringify(profile)); go('generating'); };
  const openSettings = () => go(profile.name ? 'settings' : 'welcome');
  const toggleChangeArea = (v: string) => setChangeAreas((old) => old.includes(v) ? old.filter((item) => item !== v) : [...old, v]);

  useEffect(() => {
    if (screen !== 'generating') return;
    let active = true;
    getLookRecommendations(profile)
      .then((recommendations) => generateLookImages(recommendations, profile, { occasion: profile.occasion, details: profile.occasionDetails }))
      .then((result) => { if (active) { setGeneratedLooks(result); go('results'); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: generation begins once per entry into this screen
  }, [screen]);

  useEffect(() => { localStorage.setItem('skintune-saved-looks', JSON.stringify(savedLooks)); }, [savedLooks]);

  const currentLook = useMemo(() => generatedLooks.find((item) => item.id === detailId) || generatedLooks[0], [generatedLooks, detailId]);

  if (screen === 'welcome') return <Welcome onStart={() => go('name')} onPrivacy={() => go('settings')} />;
  if (screen === 'home') return <Home profile={profile} savedLooks={savedLooks} generatedLooks={generatedLooks} onNew={() => { update({ photoUrl: '' }); go('name'); }} onResults={() => go(generatedLooks.length ? 'results' : 'generating')} onSettings={openSettings} onLook={(id) => { setDetailId(id); go('detail'); }} onQuickStart={(occasion) => { update({ occasion }); go('impression'); }} />;
  if (screen === 'settings') return <Settings profile={profile} deletedNotice={deletedNotice} onBack={() => go(profile.name ? 'home' : 'welcome')} onDelete={() => { localStorage.removeItem('skintune-profile'); localStorage.removeItem('skintune-saved-looks'); localStorage.removeItem('skintune-feedback'); setProfile(initialProfile); setDeletedNotice(true); setTimeout(() => go('welcome'), 900); }} />;
  if (screen === 'photo') return <PhotoPanel profile={profile} update={update} onContinue={() => go('appearance')} onBack={back} />;
  if (screen === 'results') return <Results profile={profile} looks={generatedLooks} savedLooks={savedLooks} onSave={(id) => setSavedLooks((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id])} onLook={(id) => { setDetailId(id); go('detail'); }} onFeedback={() => go('feedback')} onBack={() => go('home')} />;
  if (screen === 'detail' && currentLook) return <LookDetail look={currentLook} saved={savedLooks.includes(currentLook.id)} onSave={() => setSavedLooks((old) => old.includes(currentLook.id) ? old.filter((item) => item !== currentLook.id) : [...old, currentLook.id])} onBack={back} onFeedback={() => go('feedback')} />;
  if (screen === 'feedback') return <Feedback feeling={feeling} setFeeling={setFeeling} changeAreas={changeAreas} toggleChangeArea={toggleChangeArea} request={changeRequest} setRequest={setChangeRequest} onBack={back} onDone={() => {
    localStorage.setItem('skintune-feedback', JSON.stringify({ feeling, changeAreas, changeRequest }));
    if (feeling === 'Not my style') { setFeeling(''); setChangeAreas([]); setChangeRequest(''); go('generating'); } else { go('results'); }
  }} />;
  if (screen === 'generating') return <Generating />;

  const screenContent: Record<string, ReactNode> = {
    name: <NameStep profile={profile} update={update} onNext={() => go('profile')} onBack={back} />,
    profile: <SingleChoiceStep profile={profile} update={update} field="pronouns" step={2} eyebrow="02 / a little context" title="How should we write your styling advice?" body="Choose the language and point of view that feels most like you." options={pronounOptions} onNext={() => go('age')} onBack={back} />,
    age: <SingleChoiceStep profile={profile} update={update} field="ageGroup" step={3} eyebrow="03 / a little context" title="Which age range feels right?" body="This helps us tune proportions and references. There's no wrong answer." options={ageGroupOptions} onNext={() => go('height')} onBack={back} />,
    height: <HeightStep profile={profile} update={update} step={4} eyebrow="04 / a little context" title="What's your height?" body="Optional — helps us tune proportion suggestions." onNext={() => go('consent')} onBack={back} />,
    consent: <ConsentStep profile={profile} onNext={() => go('photo')} onBack={back} />,
    appearance: <AppearanceStep profile={profile} onNext={() => go('body')} onPhoto={() => go('photo')} onBack={back} />,
    body: <SingleChoiceStep profile={profile} update={update} field="bodyBuild" step={8} eyebrow="08 / your canvas" title="How would you describe your build?" body="There's no right answer. Pick what feels most useful when you get dressed." options={bodyBuildOptions} onNext={() => go('fit')} onBack={back} />,
    fit: <SingleChoiceStep profile={profile} update={update} field="fit" step={9} eyebrow="09 / your canvas" title="What fit feels like you?" body="Pick the silhouette you reach for most." options={fitOptions} onNext={() => go('priorities')} onBack={back} />,
    priorities: <SingleChoiceStep profile={profile} update={update} field="priorities" step={10} eyebrow="10 / your canvas" title="What matters most right now?" body="Style, comfort, or a balance of both." options={priorityOptions} onNext={() => go('style')} onBack={back} />,
    style: <MultiChoiceStep profile={profile} update={update} field="style" step={11} eyebrow="11 / your point of view" title="Which style worlds pull you in?" body="Choose as many as you like. Personal style is usually a good sentence, not a single word." options={styleOptions} onNext={() => go('colors')} onBack={back} />,
    colors: <MultiChoiceStep profile={profile} update={update} field="colorsLove" step={12} eyebrow="12 / your color language" title="Which colors do you reach for?" body="Your favorites matter more than any color theory." options={colorLoveOptions} max={5} onNext={() => go('colors-avoid')} onBack={back} />,
    'colors-avoid': <MultiChoiceStep profile={profile} update={update} field="colorsAvoid" step={13} eyebrow="13 / your color language" title="Anything you tend to avoid?" body="Optional. Skip this if you're open to exploring." options={colorAvoidOptions} optional onNext={() => go('restrictions')} onBack={back} />,
    restrictions: <MultiChoiceStep profile={profile} update={update} field="restrictions" step={14} eyebrow="14 / make it wearable" title="Anything we should work around?" body="Choose anything that would help you enjoy wearing the suggestions. This is optional." options={restrictionOptions} optional onNext={() => go('occasion')} onBack={back} />,
    occasion: <SingleChoiceStep profile={profile} update={update} field="occasion" step={15} eyebrow="15 / the moment" title="Where are you getting dressed for?" body="A look should support the room you're walking into, not distract you from being there." options={occasionOptions} onNext={() => go('context')} onBack={back} />,
    context: <ContextStep profile={profile} update={update} onNext={() => go('impression')} onBack={back} />,
    impression: <MultiChoiceStep profile={profile} update={update} field="impression" step={17} eyebrow="17 / the feeling" title="How do you want to come across?" body="Pick one or two. These words shape the balance between color, ease, and structure." options={impressionOptions} max={2} onNext={() => go('budget')} onBack={back} />,
    budget: <SingleChoiceStep profile={profile} update={update} field="budget" step={18} eyebrow="18 / keep it real" title="What feels comfortable for this edit?" body="We'll use this as a guide for where to spend and where to save. It's never a test of taste." options={budgetOptions} onNext={() => go('review')} onBack={back} />,
    review: <Review profile={profile} onEdit={(target) => go(target)} onSave={saveProfile} onBack={back} />,
  };
  return <>{screenContent[screen]}</>;
}

function Review({ profile, onEdit, onSave, onBack }: { profile: SkinTuneProfile; onEdit: (s: Screen) => void; onSave: () => void; onBack: () => void }) {
  const rows: { label: string; value: string; target: Screen }[] = [
    { label: 'Appearance', value: `${profile.appearance.skinTone} · ${profile.appearance.undertone} undertone · ${profile.appearance.confidence}% confidence`, target: 'appearance' },
    { label: 'Profile', value: `${profile.pronouns} · ${profile.ageGroup}`, target: 'profile' },
    { label: 'Build + fit', value: `${profile.bodyBuild} · ${profile.fit.join(', ')}`, target: 'body' },
    { label: 'Style', value: profile.style.join(', '), target: 'style' },
    { label: 'Colors', value: `Loves ${profile.colorsLove.join(', ')}${profile.colorsAvoid.length ? ` · avoids ${profile.colorsAvoid.join(', ')}` : ''}`, target: 'colors' },
    { label: 'Moment', value: `${profile.occasion} · ${profile.occasionDetails}`, target: 'occasion' },
    { label: 'Impression', value: `${profile.impression.join(', ')} · ${profile.budget}`, target: 'impression' },
  ];
  return <StepShell profile={profile} onBack={onBack} step={19}><Intro eyebrow="19 / your edit, at a glance" title={`This sounds like ${profile.name}.`} body="Look it over, make any changes, then we'll make five complete looks around it.">
    <div className="divide-y divide-border overflow-hidden rounded-[1.5rem] border border-border bg-card">{rows.map((row) => <div key={row.label} className="flex items-start justify-between gap-4 p-5"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">{row.label}</p><p className="mt-1 line-clamp-2 text-sm leading-relaxed">{row.value}</p></div><button type="button" onClick={() => onEdit(row.target)} data-testid={`button-edit-${row.label.toLowerCase().replace(' ', '-')}`} className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-primary hover:bg-secondary"><Pencil size={13} /> Edit</button></div>)}</div>
    <FooterActions onBack={onBack} onContinue={onSave} label="✨ Make my five looks" />
  </Intro></StepShell>;
}

function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary resetKey="skintune"><SkinTune /></ErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider>; }

export default App;
