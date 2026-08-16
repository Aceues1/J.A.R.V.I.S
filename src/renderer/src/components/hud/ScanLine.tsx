export function ScanLine(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-bright/70 to-transparent animate-[var(--animate-scan)]" />
    </div>
  )
}
