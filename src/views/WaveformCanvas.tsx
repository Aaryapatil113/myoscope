import { useEffect, useRef } from 'react';
import type { DashboardViewModel } from '../viewmodel/DashboardViewModel';
import { SAMPLE_RATE } from '../model/SensorSimulator';

interface Props {
  vm: DashboardViewModel;
  channelId: number;
  color: string;
  windowSeconds: number;
  mvcMv: number | null;
  label: string;
}

const Y_RANGE_MV = 2.5; // ±2.5 mV visible

/**
 * Draws raw EMG plus its RMS envelope on a canvas.
 * Runs on requestAnimationFrame and reads the ViewModel's buffers
 * directly, so 8,000 samples/second never pass through React state.
 * Uses min/max decimation: one vertical line per pixel column.
 */
export function WaveformCanvas({ vm, channelId, color, windowSeconds, mvcMv, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawGrid(ctx, w, h, windowSeconds);

      const { raw, envelope } = vm.getTrace(channelId);
      const windowSamples = windowSeconds * SAMPLE_RATE;
      const total = Math.min(raw.length, windowSamples);
      const mid = h / 2;
      const scale = (h / 2 - 4) / Y_RANGE_MV;
      const samplesPerPx = windowSamples / w;

      if (mvcMv) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, mid - mvcMv * scale);
        ctx.lineTo(w, mid - mvcMv * scale);
        ctx.stroke();
        ctx.restore();
      }

      if (total > 1) {
        const start = raw.length - total;
        const xOffset = w - total / samplesPerPx; // newest sample sits on the right edge
        const columns = Math.floor(total / samplesPerPx);

        // Raw signal: min/max per pixel column
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.32;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let px = 0; px < columns; px++) {
          const from = start + Math.floor(px * samplesPerPx);
          const to = Math.min(start + Math.floor((px + 1) * samplesPerPx), raw.length);
          let min = Infinity;
          let max = -Infinity;
          for (let i = from; i < to; i++) {
            const v = raw.at(i);
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const x = xOffset + px + 0.5;
          ctx.moveTo(x, mid - Math.min(max, Y_RANGE_MV) * scale);
          ctx.lineTo(x, mid - Math.max(min, -Y_RANGE_MV) * scale);
        }
        ctx.stroke();

        // RMS envelope
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let px = 0; px < columns; px++) {
          const i = Math.min(start + Math.floor((px + 1) * samplesPerPx) - 1, envelope.length - 1);
          const y = mid - Math.min(envelope.at(i), Y_RANGE_MV) * scale;
          const x = xOffset + px + 0.5;
          if (px === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [vm, channelId, color, windowSeconds, mvcMv]);

  return <canvas ref={canvasRef} className="trace" role="img" aria-label={`Live EMG trace for ${label}`} />;
}

/** Chart-paper grid: a line every 0.2 s, heavier every second, and every 0.5 mV. */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, windowSeconds: number) {
  const pxPerSecond = w / windowSeconds;
  const mid = h / 2;
  const mvStep = (h / 2 - 4) / Y_RANGE_MV / 2; // 0.5 mV

  ctx.lineWidth = 1;
  for (let i = 0; i <= windowSeconds * 5; i++) {
    const x = Math.round(w - i * (pxPerSecond / 5)) + 0.5;
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(31, 111, 178, 0.18)' : 'rgba(31, 111, 178, 0.07)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let k = -5; k <= 5; k++) {
    const y = Math.round(mid - k * mvStep) + 0.5;
    ctx.strokeStyle = k === 0 ? 'rgba(23, 38, 58, 0.25)' : k % 2 === 0 ? 'rgba(31, 111, 178, 0.14)' : 'rgba(31, 111, 178, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}
