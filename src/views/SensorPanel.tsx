import type { DashboardState } from '../viewmodel/DashboardViewModel';

interface Props {
  state: DashboardState;
  onToggle: (id: number) => void;
}

const QUALITY_LABEL = { good: 'Good signal', fair: 'Fair signal, check electrode contact', poor: 'Poor signal' };

export function SensorPanel({ state, onToggle }: Props) {
  return (
    <aside className="sensors" aria-label="Sensors">
      <h2>Sensors</h2>
      <ul>
        {state.channels.map((ch) => (
          <li key={ch.id} className={ch.visible ? '' : 'off'}>
            <label>
              <input type="checkbox" checked={ch.visible} onChange={() => onToggle(ch.id)} />
              <span className="swatch" style={{ background: ch.color }} aria-hidden="true" />
              <span className="sensor-name">
                {ch.muscle}
                <small>Sensor {ch.id}, {ch.side.toLowerCase()} arm</small>
              </span>
            </label>
            <div className="sensor-meta">
              <span className={`quality ${ch.status.quality}`} title={QUALITY_LABEL[ch.status.quality]}>
                {ch.status.quality === 'good' ? 'Good' : ch.status.quality === 'fair' ? 'Fair' : 'Poor'}
              </span>
              <span className={`battery ${ch.status.battery < 20 ? 'low' : ''}`}
                aria-label={`Battery ${ch.status.battery} percent`}>
                <span className="battery-fill" style={{ width: `${ch.status.battery}%` }} />
              </span>
              <span className="battery-pct">{ch.status.battery}%</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="sensor-state">{state.isStreaming ? 'Streaming at 2,000 Hz' : 'Sensors paired, not streaming'}</p>
    </aside>
  );
}
