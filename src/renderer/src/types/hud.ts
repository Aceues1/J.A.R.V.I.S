export type StatusLevel = 'online' | 'standby' | 'listening' | 'processing' | 'speaking' | 'alert'

export interface NavItem {
  id: string
  label: string
  icon: 'core' | 'diagnostics' | 'conversations' | 'settings'
}

export interface ConversationItem {
  id: string
  title: string
  timestamp: string
  preview: string
}

export interface TelemetryMetric {
  id: string
  label: string
  value: number
  unit: string
  history: number[]
}

export interface LogEntry {
  id: string
  time: string
  level: 'info' | 'warn' | 'ok'
  message: string
}

export interface MarketQuote {
  symbol: string
  name: string
  last: number
  change: number
  changePercent: number
  history: number[]
}

export interface EventItem {
  id: string
  time: string
  title: string
}

export interface NoteItem {
  id: string
  time: string
  text: string
}

export type WeatherIcon =
  'sun' | 'part-cloud' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

export interface LocationWeather {
  id: string
  label: string
  temperature: number
  feelsLike: number
  condition: string
  icon: WeatherIcon
  windSpeed: number
  high: number
  low: number
}

export interface WeatherReport {
  updatedAt: number
  locations: LocationWeather[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
}
