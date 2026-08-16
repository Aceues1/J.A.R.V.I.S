import type { ConversationItem } from '@renderer/types/hud'

export function ConversationsList({ items }: { items: ConversationItem[] }): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto px-2 py-3">
      <p className="mb-2 px-2 font-mono text-[10px] tracking-[0.25em] text-ink-dim uppercase">
        Conversations
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="block w-full px-2 py-2 text-left transition-colors hover:bg-panel-raised"
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-xs text-ink">{item.title}</span>
              <span className="shrink-0 font-mono text-[9px] text-ink-dim">{item.timestamp}</span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-dim">{item.preview}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
