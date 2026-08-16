import type { NavItem } from '@renderer/types/hud'
import { cn } from '@renderer/lib/cn'

const icons: Record<NavItem['icon'], React.JSX.Element> = {
  core: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  ),
  diagnostics: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 8h2.5l1.5-4 2 8 1.5-5.5L9.5 8H13" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  ),
  conversations: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2.5" width="11" height="7.5" stroke="currentColor" />
      <path d="M4 12.5l2-2.5" stroke="currentColor" />
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" />
      <path
        d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4"
        stroke="currentColor"
      />
    </svg>
  )
}

export function NavList({
  items,
  activeId,
  onSelect
}: {
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <nav className="border-b border-cyan-dim/40 px-2 py-3">
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left font-sans text-sm tracking-wide transition-colors',
              active ? 'bg-cyan/10 text-cyan' : 'text-ink-dim hover:bg-panel-raised hover:text-ink'
            )}
          >
            <span className={active ? 'text-cyan' : 'text-ink-dim'}>{icons[item.icon]}</span>
            {item.label}
            {active && <span className="ml-auto h-1 w-1 rounded-full bg-cyan" />}
          </button>
        )
      })}
    </nav>
  )
}
