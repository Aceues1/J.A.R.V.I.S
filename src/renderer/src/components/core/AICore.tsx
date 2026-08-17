import { memo } from 'react'
import type { StatusLevel } from '@renderer/types/hud'

const TICK_COUNT = 48
const NODE_ANGLES = [15, 95, 170, 260, 320]

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

export const AICore = memo(function AICore({ status }: { status: StatusLevel }): React.JSX.Element {
  const isActive = status !== 'standby'

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="pointer-events-none absolute -inset-[15%] rounded-full bg-cyan/5 blur-3xl" />

      <svg viewBox="0 0 400 400" className="relative h-full w-full">
        <defs>
          <radialGradient id="core-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bffcff" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#00e5ff" stopOpacity="0.75" />
            <stop offset="75%" stopColor="#00e5ff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
          </radialGradient>
          <filter id="core-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Outer tick ring */}
        <g className="origin-center animate-[var(--animate-ring-slow)] opacity-70">
          {Array.from({ length: TICK_COUNT }).map((_, i) => {
            const angle = (360 / TICK_COUNT) * i
            const [x1, y1] = polar(200, 200, 178, angle)
            const [x2, y2] = polar(200, 200, i % 4 === 0 ? 164 : 171, angle)
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#00e5ff"
                strokeWidth={i % 4 === 0 ? 1.4 : 0.8}
                opacity={i % 4 === 0 ? 0.85 : 0.4}
              />
            )
          })}
        </g>

        {/* Middle dashed ring with orbit nodes */}
        <g className="origin-center animate-[var(--animate-ring-slow-reverse)]">
          <circle
            cx={200}
            cy={200}
            r={140}
            fill="none"
            stroke="#00e5ff"
            strokeWidth={1}
            strokeDasharray="2 10"
            opacity={0.55}
          />
          {NODE_ANGLES.map((angle, i) => {
            const [x, y] = polar(200, 200, 140, angle)
            return <circle key={i} cx={x} cy={y} r={3} className="fill-cyan-bright" />
          })}
        </g>

        {/* Inner static ring */}
        <circle
          cx={200}
          cy={200}
          r={108}
          fill="none"
          stroke="#00e5ff"
          strokeWidth={1}
          opacity={0.3}
        />

        {/* Targeting arcs */}
        <g
          className="origin-center animate-[var(--animate-ring-slow)]"
          style={{ animationDuration: '26s' }}
        >
          <path
            d={describeArc(200, 200, 122, 20, 100)}
            fill="none"
            stroke="#7cffff"
            strokeWidth={2}
            opacity={0.8}
          />
          <path
            d={describeArc(200, 200, 122, 200, 280)}
            fill="none"
            stroke="#7cffff"
            strokeWidth={2}
            opacity={0.8}
          />
        </g>

        {/* Core */}
        <circle
          cx={200}
          cy={200}
          r={70}
          fill="url(#core-gradient)"
          filter="url(#core-blur)"
          className="origin-center animate-[var(--animate-core-pulse)]"
          style={{ animationPlayState: isActive ? 'running' : 'paused' }}
        />
        <circle
          cx={200}
          cy={200}
          r={46}
          fill="none"
          stroke="#d8fbff"
          strokeWidth={1}
          opacity={0.5}
        />
        <circle cx={200} cy={200} r={4} className="fill-ink" />
      </svg>
    </div>
  )
})

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const [x1, y1] = polar(cx, cy, r, startAngle)
  const [x2, y2] = polar(cx, cy, r, endAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2}`
}
