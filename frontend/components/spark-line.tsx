type SparkLineProps = {
  prices: number[]
  width?: number
  height?: number
}

export function SparkLine({ prices, width = 80, height = 28 }: SparkLineProps) {
  if (prices.length < 2) return null

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const pad = 2

  const pts = prices
    .map((p, i) => {
      const x = pad + (i / (prices.length - 1)) * (width - pad * 2)
      const y = pad + (1 - (p - min) / range) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const up = prices[prices.length - 1] >= prices[0]
  const color = up ? '#10b981' : '#ef4444'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block"
    >
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
