import type { NoteItem } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'

export function NotesActivityCard({ notes }: { notes: NoteItem[] }): React.JSX.Element {
  return (
    <HudPanel title="Notes &amp; Activity" eyebrow="Log">
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="flex gap-3 font-mono text-[11px]">
            <span className="shrink-0 text-ink-dim/70">{note.time}</span>
            <span className="text-ink-dim">{note.text}</span>
          </li>
        ))}
      </ul>
    </HudPanel>
  )
}
