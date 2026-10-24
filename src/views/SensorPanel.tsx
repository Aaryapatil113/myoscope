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
              {ch.connection === 'reconnecting' ? (
                <span className="quality reconnecting" title="Wireless link lost. Trying to reconnect.">Reconnecting…</span>
              ) : (
                <span className={`quality ${ch.status.quality}`} title={QUALITY_LABEL[ch.status.quality]}>
                  {ch.status.quality === 'good' ? 'Good' : ch.status.quality === 'fair' ? 'Fair' : 'Poor'}
                </span>
              )}
              <span className={`battery ${ch.status.battery < 20 ? 'low' : ''}`}
                aria-label={`Battery ${ch.status.battery} percent`}>
                <span className="battery-fill" style={{ width: `${ch.status.battery}%` }} />
              </span>
              <span className="battery-pct">{ch.status.battery}%</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="sensor-state">{sensorState(state)}</p>
    </aside>
  );
}

function sensorState(state: DashboardState): string {
  if (!state.isStreaming) return 'Sensors paired, not streaming';
  const offline = state.channels.filter((ch) => ch.connection === 'reconnecting').length;
  if (offline === 0) return 'Streaming at 2,000 Hz';
  return `Streaming at 2,000 Hz. ${offline} sensor${offline > 1 ? 's' : ''} reconnecting`;
}
