import type { ConversationItem, NavItem, StatusLevel, TelemetryMetric } from '@renderer/types/hud'
import { IdentityBlock } from '@renderer/components/sidebar/IdentityBlock'
import { SystemStatusBlock } from '@renderer/components/sidebar/SystemStatusBlock'
import { NavList } from '@renderer/components/sidebar/NavList'
import { ConversationsList } from '@renderer/components/sidebar/ConversationsList'

interface SidebarProps {
  status: StatusLevel
  metrics: TelemetryMetric[]
  navItems: NavItem[]
  activeNavId: string
  onSelectNav: (id: string) => void
  conversations: ConversationItem[]
}

export function Sidebar({
  status,
  metrics,
  navItems,
  activeNavId,
  onSelectNav,
  conversations
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-cyan-dim/40 bg-void-deep/60 lg:flex">
      <IdentityBlock status={status} />
      <SystemStatusBlock metrics={metrics.slice(0, 2)} />
      <NavList items={navItems} activeId={activeNavId} onSelect={onSelectNav} />
      <ConversationsList items={conversations} />
      <div className="border-t border-cyan-dim/40 px-4 py-3 font-mono text-[10px] tracking-[0.15em] text-ink-dim">
        JARVIS · BUILD 0.2.0
      </div>
    </aside>
  )
}
