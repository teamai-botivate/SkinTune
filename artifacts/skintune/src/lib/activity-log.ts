// Lightweight, real (not cosmetic) step-tracking for long-running flows
// like the dress search — see App.tsx's Generating screen and CLAUDE.md's
// note on the search-hangs-with-no-feedback bug this was built to fix.
//
// Each step is logged to the browser console with a timestamp AND kept in
// a small in-memory list a screen can render as a checklist, so a user (or
// a developer reading DevTools) can see exactly how far a request got and
// where it failed — not just "something went wrong" after however long the
// spinner felt like spinning.

export type LogStatus = 'pending' | 'active' | 'done' | 'error';

export type LogStep = {
  label: string;
  status: LogStatus;
  detail?: string;
};

/** Console-logs one step transition with a timestamp, prefixed for easy filtering in DevTools. */
function logToConsole(label: string, status: LogStatus, detail?: string) {
  const time = new Date().toISOString().split('T')[1]?.replace('Z', '');
  const prefix = `[SkinTune ${time}]`;
  if (status === 'error') console.error(`${prefix} ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  else if (status === 'done') console.log(`${prefix} ✓ ${label}`);
  else if (status === 'active') console.log(`${prefix} … ${label}`);
}

/**
 * A tiny step tracker: call `.start(label)` when a step begins, `.done()`
 * to mark it complete, `.fail(detail)` to mark it failed. `onChange` fires
 * with the full step list after every transition, so a component can
 * re-render a live checklist from it.
 */
export function createActivityLog(steps: string[], onChange: (steps: LogStep[]) => void) {
  const state: LogStep[] = steps.map((label) => ({ label, status: 'pending' }));
  const emit = () => onChange([...state]);

  return {
    start(label: string) {
      const step = state.find((s) => s.label === label);
      if (!step) return;
      step.status = 'active';
      logToConsole(label, 'active');
      emit();
    },
    done(label: string) {
      const step = state.find((s) => s.label === label);
      if (!step) return;
      step.status = 'done';
      logToConsole(label, 'done');
      emit();
    },
    fail(label: string, detail: string) {
      const step = state.find((s) => s.label === label);
      if (!step) return;
      step.status = 'error';
      step.detail = detail;
      logToConsole(label, 'error', detail);
      emit();
    },
  };
}
