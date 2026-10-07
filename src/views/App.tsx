import { useEffect, useState } from 'react';
import { DashboardViewModel } from '../viewmodel/DashboardViewModel';
import { useViewModel } from '../viewmodel/useViewModel';
import { Toolbar } from './Toolbar';
import { SensorPanel } from './SensorPanel';
import { ChannelStrip } from './ChannelStrip';
import { CalibrationBanner } from './CalibrationBanner';
import { FatiguePanel } from './FatiguePanel';

export function App() {
  // One ViewModel instance for the lifetime of the app
  const [vm] = useState(() => new DashboardViewModel());
  const state = useViewModel(vm);

  useEffect(() => () => vm.dispose(), [vm]);

  const visibleChannels = state.channels.filter((c) => c.visible);

  return (
    <div className="app">
      <Toolbar state={state} vm={vm} />
      <CalibrationBanner calibration={state.calibration} />
      <div className="workspace">
        <div className="sidebar">
          <SensorPanel state={state} onToggle={vm.toggleChannel} />
          <FatiguePanel fatigue={state.fatigue} isStreaming={state.isStreaming} />
        </div>
        <main className="traces" aria-label="Live muscle activity">
          {visibleChannels.length === 0 && (
            <p className="empty">All sensors are hidden. Turn one on in the sensor list to see its trace.</p>
          )}
          {visibleChannels.map((channel) => (
            <ChannelStrip
              key={channel.id}
              channel={channel}
              vm={vm}
              windowSeconds={state.windowSeconds}
              showStartHint={!state.hasData}
            />
          ))}
        </main>
      </div>
    </div>
  );
}
