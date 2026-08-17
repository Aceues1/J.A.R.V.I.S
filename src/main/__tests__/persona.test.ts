import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '../persona'

// These tests pin the personality contract: they don't judge model output
// (that needs the live API), but they fail if a directive the milestone
// depends on is ever dropped or diluted from the persona.

describe('persona system prompt', () => {
  it('establishes the composed, precise character', () => {
    expect(SYSTEM_PROMPT).toMatch(/calm, composed, precise/i)
    expect(SYSTEM_PROMPT).toMatch(/Stay composed at all times/i)
    expect(SYSTEM_PROMPT).toMatch(/Answer the actual question directly/i)
  })

  it('keeps wit subtle and forbids theatrical or fictional-character behavior', () => {
    expect(SYSTEM_PROMPT).toMatch(/rare and subtle/i)
    expect(SYSTEM_PROMPT).toMatch(/not a comedian/i)
    expect(SYSTEM_PROMPT).toMatch(/never present yourself as any fictional or film character/i)
    expect(SYSTEM_PROMPT).toMatch(/never quote films/i)
  })

  it('moderates "sir" usage and honors address preferences', () => {
    expect(SYSTEM_PROMPT).toMatch(/At most once in a reply/i)
    expect(SYSTEM_PROMPT).toMatch(/many replies need none/i)
    expect(SYSTEM_PROMPT).toMatch(/asks to be addressed differently.*comply immediately/is)
  })

  it('demands conversation continuity and reference resolution', () => {
    expect(SYSTEM_PROMPT).toMatch(/one continuous conversation/i)
    expect(SYSTEM_PROMPT).toMatch(/"it", "that one", "the second one"/)
    expect(SYSTEM_PROMPT).toMatch(/don't re-ask questions/i)
    expect(SYSTEM_PROMPT).toMatch(/transcription errors/i)
  })

  it('bans generic chatbot filler and unsolicited closers', () => {
    expect(SYSTEM_PROMPT).toMatch(/"Absolutely!"/)
    expect(SYSTEM_PROMPT).toMatch(/"Great question!"/)
    expect(SYSTEM_PROMPT).toMatch(/Do not append closers/i)
    expect(SYSTEM_PROMPT).toMatch(/"How can I help you today\?"/)
  })

  it('requires speech-friendly style and length matched to the question', () => {
    expect(SYSTEM_PROMPT).toMatch(/spoken aloud/i)
    expect(SYSTEM_PROMPT).toMatch(/avoid markdown headings, bullet lists, tables/i)
    expect(SYSTEM_PROMPT).toMatch(/single short sentence/i)
    expect(SYSTEM_PROMPT).toMatch(/Vary acknowledgements/i)
  })

  it('locks in capability honesty', () => {
    expect(SYSTEM_PROMPT).toMatch(/cannot yet control the computer/i)
    expect(SYSTEM_PROMPT).toMatch(
      /Never state or imply that an action was performed when the application did not perform it/i
    )
    expect(SYSTEM_PROMPT).toMatch(/don't have computer-control access yet/i)
    expect(SYSTEM_PROMPT).toMatch(/information may be out of date/i)
  })

  it('grants the live weather capability with strict honesty rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/weather feed for Sistranda\/Frøya and Trondheim/i)
    expect(SYSTEM_PROMPT).toMatch(/answer from the live feed, never from memory/i)
    expect(SYSTEM_PROMPT).toMatch(/never invent or estimate current conditions/i)
    expect(SYSTEM_PROMPT).toMatch(/live weather data is temporarily unavailable/i)
    expect(SYSTEM_PROMPT).toMatch(/no live weather for other locations/i)
    expect(SYSTEM_PROMPT).toMatch(/no other live data of any kind/i)
  })
})
