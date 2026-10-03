import type { CalibrationPhase } from '../viewmodel/DashboardViewModel';

interface Props {
  calibration: { phase: CalibrationPhase; secondsLeft: number };
}

const COPY: Record<Exclude<CalibrationPhase, 'none'>, { title: string; body: string }> = {
  relax: { title: 'Relax your arm', body: 'Measuring resting baseline.' },
  contract: { title: 'Contract as hard as you can', body: 'Recording your maximum contraction for each muscle.' },
  complete: { title: 'Calibration complete', body: 'Activity now shows as a percentage of your maximum.' },
};

export function CalibrationBanner({ calibration }: Props) {
  if (calibration.phase === 'none') return null;
  const copy = COPY[calibration.phase];
  return (
    <div className={`calibration ${calibration.phase}`} role="status" aria-live="polite">
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
      {calibration.phase !== 'complete' && <span className="countdown">{calibration.secondsLeft}</span>}
    </div>
  );
}
