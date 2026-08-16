export function MeterBar({ value }: { value: number }): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="h-1 w-full overflow-hidden bg-panel-raised">
      <div
        className="h-full bg-cyan transition-[width] duration-700 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
