import type { ChannelViewState, DashboardViewModel } from '../viewmodel/DashboardViewModel';
import { WaveformCanvas } from './WaveformCanvas';
import { formatMv } from './format';

interface Props {
  channel: ChannelViewState;
  vm: DashboardViewModel;
  windowSeconds: number;
  showStartHint: boolean;
}

export function ChannelStrip({ channel, vm, windowSeconds, showStartHint }: Props) {
  const calibrated = channel.percentMvc !== null;
  const meter = calibrated ? Math.min(channel.percentMvc!, 100) : Math.min((channel.rmsMv / 1.0) * 100, 100);

  return (
    <section className="strip" style={{ ['--channel' as string]: channel.color }}>
      <header className="strip-head">
        <h3>{channel.muscle}</h3>
        <span>{channel.side}</span>
      </header>
      <div className="strip-body">
        <div className="trace-wrap">
          <WaveformCanvas
            vm={vm}
            channelId={channel.id}
            color={channel.color}
            windowSeconds={windowSeconds}
            mvcMv={channel.mvcMv}
            label={channel.muscle}
          />
          {showStartHint && <p className="trace-hint">Press Start streaming to see live muscle activity</p>}
        </div>
        <div className="readout">
          <div className="readout-value">
            {calibrated ? Math.round(channel.percentMvc!) : formatMv(channel.rmsMv)}
            <span>{calibrated ? '% max' : 'mV'}</span>
          </div>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter)}
            aria-label={`${channel.muscle} activation`}>
            <div className="meter-fill" style={{ height: `${meter}%` }} />
          </div>
          <dl className="readout-meta">
            <div><dt>Peak</dt><dd>{formatMv(channel.peakMv)} mV</dd></div>
            <div><dt>Max</dt><dd>{channel.mvcMv ? `${formatMv(channel.mvcMv)} mV` : 'Not set'}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
