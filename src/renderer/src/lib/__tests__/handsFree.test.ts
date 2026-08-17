import { describe, expect, it } from 'vitest'
import {
  HANDS_FREE_OFF,
  MAX_CONSECUTIVE_FAILURES,
  handsFreeReducer,
  type HandsFreeEvent,
  type HandsFreeState
} from '../handsFree'

function run(state: HandsFreeState, events: HandsFreeEvent[]): HandsFreeState {
  return events.reduce(handsFreeReducer, state)
}

describe('handsFreeReducer', () => {
  it('starts off and stays off until enabled', () => {
    expect(HANDS_FREE_OFF.phase).toBe('off')
    const state = run(HANDS_FREE_OFF, [
      { type: 'capture' },
      { type: 'pipeline-ok', willSpeak: true },
      { type: 'speech-ended' },
      { type: 'no-speech' }
    ])
    expect(state).toEqual(HANDS_FREE_OFF)
  })

  it('runs the full conversation loop: listen → think → speak → listen', () => {
    let state = handsFreeReducer(HANDS_FREE_OFF, { type: 'enable' })
    expect(state.phase).toBe('listening')

    state = handsFreeReducer(state, { type: 'capture' })
    expect(state.phase).toBe('thinking')

    state = handsFreeReducer(state, { type: 'pipeline-ok', willSpeak: true })
    expect(state.phase).toBe('speaking')

    state = handsFreeReducer(state, { type: 'speech-ended' })
    expect(state.phase).toBe('listening')
  })

  it('skips the speaking phase when TTS will not play', () => {
    const state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'capture' },
      { type: 'pipeline-ok', willSpeak: false }
    ])
    expect(state.phase).toBe('listening')
  })

  it('stays listening through silent windows', () => {
    const state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'no-speech' },
      { type: 'no-speech' }
    ])
    expect(state.phase).toBe('listening')
  })

  it('disable turns the loop off from any phase', () => {
    for (const events of [
      [{ type: 'enable' }],
      [{ type: 'enable' }, { type: 'capture' }],
      [{ type: 'enable' }, { type: 'capture' }, { type: 'pipeline-ok', willSpeak: true }]
    ] as HandsFreeEvent[][]) {
      const state = run(HANDS_FREE_OFF, [...events, { type: 'disable' }])
      expect(state).toEqual(HANDS_FREE_OFF)
    }
  })

  it('retries listening after a recoverable failure', () => {
    const state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'capture' },
      { type: 'pipeline-error', recoverable: true }
    ])
    expect(state.phase).toBe('listening')
    expect(state.consecutiveFailures).toBe(1)
  })

  it('shuts off after too many consecutive recoverable failures', () => {
    let state = handsFreeReducer(HANDS_FREE_OFF, { type: 'enable' })
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
      state = handsFreeReducer(state, { type: 'pipeline-error', recoverable: true })
    }
    expect(state).toEqual(HANDS_FREE_OFF)
  })

  it('a successful round trip resets the failure count', () => {
    const state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'pipeline-error', recoverable: true },
      { type: 'capture' },
      { type: 'pipeline-ok', willSpeak: false }
    ])
    expect(state.phase).toBe('listening')
    expect(state.consecutiveFailures).toBe(0)
  })

  it('shuts off immediately on a non-recoverable failure', () => {
    const state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'capture' },
      { type: 'pipeline-error', recoverable: false }
    ])
    expect(state).toEqual(HANDS_FREE_OFF)
  })

  it('ignores out-of-phase events (duplicate replies, late speech-ended)', () => {
    // Duplicate pipeline-ok while already speaking
    let state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'capture' },
      { type: 'pipeline-ok', willSpeak: true },
      { type: 'pipeline-ok', willSpeak: true }
    ])
    expect(state.phase).toBe('speaking')

    // speech-ended while listening (late event after manual stop)
    state = run(HANDS_FREE_OFF, [{ type: 'enable' }, { type: 'speech-ended' }])
    expect(state.phase).toBe('listening')

    // capture while thinking (should be impossible; must not double-advance)
    state = run(HANDS_FREE_OFF, [{ type: 'enable' }, { type: 'capture' }, { type: 'capture' }])
    expect(state.phase).toBe('thinking')

    // enable while already running keeps state
    state = run(HANDS_FREE_OFF, [
      { type: 'enable' },
      { type: 'capture' },
      { type: 'pipeline-error', recoverable: true },
      { type: 'enable' }
    ])
    expect(state.consecutiveFailures).toBe(1)
  })
})
