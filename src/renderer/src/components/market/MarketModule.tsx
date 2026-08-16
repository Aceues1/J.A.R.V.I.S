import type { MarketQuote } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { Sparkline } from '@renderer/components/hud/Sparkline'
import { cn } from '@renderer/lib/cn'

export function MarketModule({ quotes }: { quotes: MarketQuote[] }): React.JSX.Element {
  return (
    <HudPanel title="Market Module" eyebrow="NQ / ES">
      <div className="space-y-3">
        {quotes.map((quote) => {
          const positive = quote.change >= 0
          return (
            <div
              key={quote.symbol}
              className="flex items-center justify-between border border-cyan-dim/30 px-3 py-2"
            >
              <div>
                <p className="font-display text-sm text-ink">{quote.symbol}</p>
                <p className="font-mono text-[9px] tracking-[0.1em] text-ink-dim">{quote.name}</p>
              </div>
              <Sparkline
                values={quote.history}
                width={72}
                height={24}
                strokeClassName={positive ? 'stroke-good' : 'stroke-alert'}
              />
              <div className="text-right">
                <p className="font-mono text-sm text-ink">{quote.last.toLocaleString()}</p>
                <p className={cn('font-mono text-[10px]', positive ? 'text-good' : 'text-alert')}>
                  {positive ? '+' : ''}
                  {quote.change.toFixed(2)} ({positive ? '+' : ''}
                  {quote.changePercent.toFixed(2)}%)
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </HudPanel>
  )
}
