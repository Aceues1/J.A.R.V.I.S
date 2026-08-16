import type {
  ConversationItem,
  EventItem,
  LogEntry,
  MarketQuote,
  NavItem,
  NoteItem
} from '@renderer/types/hud'

export const navItems: NavItem[] = [
  { id: 'core', label: 'Command Center', icon: 'core' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics' },
  { id: 'conversations', label: 'Conversations', icon: 'conversations' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

export const conversations: ConversationItem[] = [
  {
    id: 'c1',
    title: 'Morning systems check',
    timestamp: '08:14',
    preview: 'All subsystems nominal. No overnight alerts.'
  },
  {
    id: 'c2',
    title: 'NQ session review',
    timestamp: 'Yesterday',
    preview: 'Reviewed overnight range and key levels.'
  },
  {
    id: 'c3',
    title: 'Calendar prep',
    timestamp: 'Tue',
    preview: 'Flagged upcoming high-impact releases.'
  }
]

export const diagnosticsLog: LogEntry[] = [
  { id: 'l1', time: '09:41:02', level: 'ok', message: 'Core link established' },
  { id: 'l2', time: '09:41:05', level: 'info', message: 'Interface shell initialized' },
  { id: 'l3', time: '09:41:07', level: 'info', message: 'Awaiting backend attachment' },
  { id: 'l4', time: '09:41:09', level: 'warn', message: 'Voice module offline — phase 2' },
  { id: 'l5', time: '09:41:11', level: 'ok', message: 'Telemetry stream nominal' }
]

export const marketQuotes: MarketQuote[] = [
  {
    symbol: 'NQ',
    name: 'Nasdaq-100 Futures',
    last: 21342.5,
    change: 48.25,
    changePercent: 0.23,
    history: [21180, 21205, 21260, 21230, 21290, 21310, 21275, 21342.5]
  },
  {
    symbol: 'ES',
    name: 'S&P 500 Futures',
    last: 6118.75,
    change: -6.5,
    changePercent: -0.11,
    history: [6132, 6128, 6135, 6121, 6126, 6119, 6123, 6118.75]
  }
]

export const eventItems: EventItem[] = [
  { id: 'e1', time: '10:30', title: 'CPI YoY release' },
  { id: 'e2', time: '14:00', title: 'FOMC minutes' },
  { id: 'e3', time: '16:00', title: 'Crude inventories' }
]

export const noteItems: NoteItem[] = [
  { id: 'n1', time: '07:52', text: 'GUI shell scaffold initialized.' },
  { id: 'n2', time: '08:03', text: 'Design tokens locked to HUD palette.' }
]
