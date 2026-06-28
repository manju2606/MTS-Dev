'use client'

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a3e635',
]

type Slice = { label: string; value: number }

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(
  cx: number, cy: number, r: number, startAngle: number, endAngle: number,
): string {
  const start = polarToXY(cx, cy, r, endAngle)
  const end = polarToXY(cx, cy, r, startAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`
}

export function DonutChart({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <p className="text-center text-xs text-zinc-400">No open positions</p>
  )

  const cx = 80, cy = 80, outer = 65, inner = 42
  let angle = 0
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * 360
    const start = angle
    angle += sweep
    return { ...d, start, sweep, color: COLORS[i % COLORS.length] }
  })

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
        {slices.map((s, i) => {
          if (s.sweep < 0.5) return null
          const end = s.start + s.sweep - 0.5
          return (
            <path
              key={i}
              d={`${describeArc(cx, cy, outer, s.start, end)} L ${polarToXY(cx, cy, inner, end).x} ${polarToXY(cx, cy, inner, end).y} A ${inner} ${inner} 0 ${s.sweep > 180 ? 1 : 0} 1 ${polarToXY(cx, cy, inner, s.start).x} ${polarToXY(cx, cy, inner, s.start).y} Z`}
              fill={s.color}
              opacity={0.9}
            />
          )
        })}
        <circle cx={cx} cy={cy} r={inner - 2} fill="transparent" />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {s.label}{' '}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {((s.value / total) * 100).toFixed(1)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
