import { describe, expect, it } from 'vitest'
import { canonIntent, parseActionReply } from '../intent'

describe('canonIntent', () => {
  it.each([
    ['open_app', 'open_app'],
    ['Open App', 'open_app'],
    ['launch application', 'open_app'],
    ['launch-app', 'open_app'],
    ['START_PROGRAM', 'open_app'],
    ['run app', 'open_app'],
    ['open_website', 'open_website'],
    ['open url', 'open_website'],
    ['open site', 'open_website'],
    ['browse the web', 'open_website'],
    ['visit website', 'open_website'],
    ['launch browser', 'open_website'],
    ['analyze_screen', 'analyze_screen'],
    ['analyse screen', 'analyze_screen'],
    ['look at my screen', 'analyze_screen'],
    ['screen analysis', 'analyze_screen'],
    ['describe screen', 'analyze_screen'],
    ['screenshot', 'analyze_screen'],
    ['play_video', 'play_video'],
    ['play a video', 'play_video'],
    ['play youtube video', 'play_video'],
    ['find video', 'play_video'],
    ['pause_video', 'pause_video'],
    ['pause', 'pause_video'],
    ['pause the video', 'pause_video'],
    ['resume_video', 'resume_video'],
    ['resume', 'resume_video'],
    ['continue', 'resume_video'],
    ['play again', 'resume_video'],
    ['unpause', 'resume_video'],
    ['set_volume', 'set_volume'],
    ['volume', 'set_volume'],
    ['change volume', 'set_volume'],
    ['play_music', 'play_music'],
    ['play a song', 'play_music'],
    ['play on spotify', 'play_music'],
    ['spotify', 'play_music'],
    ['pause_music', 'pause_music'],
    ['pause the music', 'pause_music'],
    ['resume_music', 'resume_music'],
    ['resume the music', 'resume_music'],
    ['next_track', 'next_track'],
    ['next', 'next_track'],
    ['skip', 'next_track'],
    ['next song', 'next_track'],
    ['previous_track', 'previous_track'],
    ['previous', 'previous_track'],
    ['last song', 'previous_track'],
    ['music_volume_up', 'music_volume_up'],
    ['volume up', 'music_volume_up'],
    ['louder', 'music_volume_up'],
    ['music_volume_down', 'music_volume_down'],
    ['volume down', 'music_volume_down'],
    ['quieter', 'music_volume_down']
  ])('normalizes %j to %s', (input, expected) => {
    expect(canonIntent(input)).toBe(expected)
  })

  it.each(['delete_files', 'run_command', 'shutdown', '', 42, null, undefined])(
    'rejects %j',
    (input) => {
      expect(canonIntent(input)).toBeNull()
    }
  )
})

describe('parseActionReply', () => {
  it('parses a bare envelope', () => {
    const parsed = parseActionReply(
      '{"action":"open_app","target":"discord","say":"Opening Discord, sir."}'
    )
    expect(parsed).toEqual({
      envelope: { action: 'open_app', target: 'discord', say: 'Opening Discord, sir.' }
    })
  })

  it('parses an envelope wrapped in a code fence', () => {
    const parsed = parseActionReply('```json\n{"action":"launch app","target":"spotify"}\n```')
    expect(parsed).toEqual({ envelope: { action: 'open_app', target: 'spotify', say: undefined } })
  })

  it('normalizes variant action names instead of dropping them', () => {
    for (const variant of ['open app', 'launch_application', 'start program']) {
      const parsed = parseActionReply(JSON.stringify({ action: variant, target: 'x' }))
      expect(parsed).toEqual({ envelope: { action: 'open_app', target: 'x', say: undefined } })
    }
  })

  it('carries volume through as a number, accepting numeric strings', () => {
    expect(parseActionReply('{"action":"set_volume","volume":40}')).toEqual({
      envelope: { action: 'set_volume', target: undefined, say: undefined, volume: 40 }
    })
    expect(parseActionReply('{"action":"set_volume","volume":"25"}')).toEqual({
      envelope: { action: 'set_volume', target: undefined, say: undefined, volume: 25 }
    })
    // Non-numeric volume is dropped here; the router rejects it downstream.
    expect(parseActionReply('{"action":"set_volume","volume":"loud"}')).toEqual({
      envelope: { action: 'set_volume', target: undefined, say: undefined, volume: undefined }
    })
  })

  it('flags well-formed envelopes with unknown actions as unsupported', () => {
    expect(parseActionReply('{"action":"delete_everything"}')).toEqual({
      unsupported: 'delete_everything'
    })
  })

  it.each([
    ['plain prose', 'Certainly, sir. The capital is Canberra.'],
    ['prose containing braces', 'Use { color: red } in your CSS, sir.'],
    ['JSON without action', '{"foo":"bar"}'],
    ['broken JSON', '{"action":"open_app",']
  ])('passes through %s as conversation', (_label, reply) => {
    expect(parseActionReply(reply)).toBeNull()
  })
})
