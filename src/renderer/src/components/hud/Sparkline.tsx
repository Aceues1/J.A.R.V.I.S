interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  strokeClassName?: string
  fillOpacity?: number
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  strokeClassName = 'stroke-cyan',
  fillOpacity = 0.12
}: SparklineProps): React.JSX.Element {
  if (values.length < 2) return <svg width={width} height={height} />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return [x, y]
  })

  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <path d={areaPath} className="fill-cyan" opacity={fillOpacity} />
      <path d={linePath} className={strokeClassName} fill="none" strokeWidth={1.4} />
    </svg>
  )
}
