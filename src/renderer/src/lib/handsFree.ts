// Hands-free conversation loop, as a pure state machine so the cycle
// (listen → think → speak → listen …) is testable without a DOM or mic.
// The hook layer in AppShell owns the side effects; this module only decides
// which phase follows which event.

export type HandsFreePhase = 'off' | 'listening' | 'thinking' | 'speaking'

export type HandsFreeEvent =
  | { type: 'enable' }
  | { type: 'disable' }
  /** Speech was captured and handed to the STT/chat pipeline. */
  | { type: 'capture' }
  /** A capture window contained no speech and was discarded locally. */
  | { type: 'no-speech' }
  /** The assistant reply arrived; willSpeak = TTS is on and will play it. */
  | { type: 'pipeline-ok'; willSpeak: boolean }
  /** STT or chat failed. recoverable = worth retrying the listen loop. */
  | { type: 'pipeline-error'; recoverable: boolean }
  /** TTS playback finished, failed, or was stopped by the user. */
  | { type: 'speech-ended' }

export interface HandsFreeState {
  phase: HandsFreePhase
  consecutiveFailures: number
}

// After this many recoverable failures in a row the loop shuts off instead
// of hammering the microphone/API.
export const MAX_CONSECUTIVE_FAILURES = 2

export const HANDS_FREE_OFF: HandsFreeState = { phase: 'off', consecutiveFailures: 0 }

export function handsFreeReducer(state: HandsFreeState, event: HandsFreeEvent): HandsFreeState {
  switch (event.type) {
    case 'enable':
      return state.phase === 'off' ? { phase: 'listening', consecutiveFailures: 0 } : state

    case 'disable':
      return HANDS_FREE_OFF

    case 'capture':
      return state.phase === 'listening' ? { ...state, phase: 'thinking' } : state

    case 'no-speech':
      // Stay in listening; the effect layer starts the next capture window.
      return state

    case 'pipeline-ok':
      if (state.phase !== 'thinking') return state
      return { phase: event.willSpeak ? 'speaking' : 'listening', consecutiveFailures: 0 }

    case 'pipeline-error': {
      if (state.phase !== 'thinking' && state.phase !== 'listening') return state
      const failures = state.consecutiveFailures + 1
      if (!event.recoverable || failures >= MAX_CONSECUTIVE_FAILURES) {
        return HANDS_FREE_OFF
      }
      return { phase: 'listening', consecutiveFailures: failures }
    }

    case 'speech-ended':
      return state.phase === 'speaking' ? { ...state, phase: 'listening' } : state
  }
}
