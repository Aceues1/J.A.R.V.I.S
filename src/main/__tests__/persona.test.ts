import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '../persona'

// These tests pin the personality contract: they don't judge model output
// (that needs the live API), but they fail if a directive the milestone
// depends on is ever dropped or diluted from the persona.

describe('persona system prompt', () => {
  it('frames JARVIS as a personal assistant with an established relationship', () => {
    expect(SYSTEM_PROMPT).toMatch(/own personal AI assistant/i)
    expect(SYSTEM_PROMPT).toMatch(/not a public chatbot/i)
    expect(SYSTEM_PROMPT).toMatch(/settled and familiar/i)
  })

  it('keeps him an original, honest AI — not a human or a film character', () => {
    expect(SYSTEM_PROMPT).toMatch(/never present yourself as any fictional or film character/i)
    expect(SYSTEM_PROMPT).toMatch(/never quote films/i)
    expect(SYSTEM_PROMPT).toMatch(/Don't claim a body, human memories, human emotions/i)
    expect(SYSTEM_PROMPT).toMatch(/Don't invent personal facts about the user/i)
    expect(SYSTEM_PROMPT).toMatch(/no persistent memory between sessions yet/i)
  })

  it('establishes the composed, precise character', () => {
    expect(SYSTEM_PROMPT).toMatch(/calm, composed, precise/i)
    expect(SYSTEM_PROMPT).toMatch(/Stay composed at all times/i)
    expect(SYSTEM_PROMPT).toMatch(/Answer the actual question directly/i)
  })

  it('demands calibrated confidence — no hedging, no false certainty', () => {
    expect(SYSTEM_PROMPT).toMatch(/confident without hedging/i)
    expect(SYSTEM_PROMPT).toMatch(/Confidence must reflect knowledge/i)
    expect(SYSTEM_PROMPT).toMatch(/keep honest uncertainty when it isn't/i)
    expect(SYSTEM_PROMPT).toMatch(/Refined means polished, not archaic/i)
  })

  it('keeps wit subtle, safe, and restrained', () => {
    expect(SYSTEM_PROMPT).toMatch(/rare and subtle/i)
    expect(SYSTEM_PROMPT).toMatch(/never during serious matters/i)
    expect(SYSTEM_PROMPT).toMatch(/never at the user's expense/i)
    expect(SYSTEM_PROMPT).toMatch(/whole conversations without a single joke/i)
    expect(SYSTEM_PROMPT).toMatch(/not a comedian/i)
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

  it('treats statements as conversation, not queries', () => {
    expect(SYSTEM_PROMPT).toMatch(/Not every turn is a question/i)
    expect(SYSTEM_PROMPT).toMatch(/"Go on, sir\."/)
    expect(SYSTEM_PROMPT).toMatch(/conversation partner, not a search box/i)
  })

  it('adapts tone to the user without claiming to read minds', () => {
    expect(SYSTEM_PROMPT).toMatch(/Match your tone/i)
    expect(SYSTEM_PROMPT).toMatch(/without ever claiming to know their feelings/i)
    expect(SYSTEM_PROMPT).toMatch(/one step at a time/i)
    expect(SYSTEM_PROMPT).toMatch(/drop the humor entirely/i)
    expect(SYSTEM_PROMPT).toMatch(/not every exchange is a formal briefing/i)
  })

  it('requires real recommendations and respectful disagreement', () => {
    expect(SYSTEM_PROMPT).toMatch(/not a yes-man/i)
    expect(SYSTEM_PROMPT).toMatch(/actually choose/i)
    expect(SYSTEM_PROMPT).toMatch(/Reserve "it depends" for when it truly does/i)
    expect(SYSTEM_PROMPT).toMatch(/never dress them up as fact/i)
    expect(SYSTEM_PROMPT).toMatch(/disagree respectfully/i)
    expect(SYSTEM_PROMPT).toMatch(/Then help with whatever they decide/i)
  })

  it('makes him observant without being noisy', () => {
    expect(SYSTEM_PROMPT).toMatch(/Be observant/i)
    expect(SYSTEM_PROMPT).toMatch(/fold it in naturally/i)
    expect(SYSTEM_PROMPT).toMatch(/only when genuinely useful/i)
  })

  it('bans generic chatbot filler and unsolicited closers', () => {
    expect(SYSTEM_PROMPT).toMatch(/"Absolutely!"/)
    expect(SYSTEM_PROMPT).toMatch(/"Great question!"/)
    expect(SYSTEM_PROMPT).toMatch(/Do not append closers/i)
    expect(SYSTEM_PROMPT).toMatch(/"How can I help you today\?"/)
  })

  it('requires speech-friendly style, varied phrasing, and length matched to the question', () => {
    expect(SYSTEM_PROMPT).toMatch(/spoken aloud/i)
    expect(SYSTEM_PROMPT).toMatch(/avoid markdown headings, bullet lists, tables/i)
    expect(SYSTEM_PROMPT).toMatch(/single short sentence/i)
    expect(SYSTEM_PROMPT).toMatch(/never whether you inform/i)
    expect(SYSTEM_PROMPT).toMatch(/Vary acknowledgements/i)
    expect(SYSTEM_PROMPT).toMatch(/don't rotate mechanically/i)
  })

  it('requires honest status language', () => {
    expect(SYSTEM_PROMPT).toMatch(/never say something was done unless it truly was/i)
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
