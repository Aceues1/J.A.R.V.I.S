// Groq's json_object response mode is generate-then-validate: when the
// model's output fails server-side JSON validation, the API answers HTTP 400
// with code "json_validate_failed" — and includes the text the model
// actually produced under error.failed_generation. That text is usually the
// (near-)JSON we asked for, so callers recover it with their own lenient
// parsers instead of retrying or falling back to a bigger model.

/**
 * Returns error.failed_generation from a Groq json_validate_failed error
 * body, or null when this is not that error. The empty string counts as
 * "this was a validation failure with nothing recoverable" — still not null
 * only when a failed_generation field was actually present.
 */
export function extractFailedGeneration(errorText: string): string | null {
  try {
    const parsed = JSON.parse(errorText) as {
      error?: { code?: unknown; failed_generation?: unknown }
    }
    if (parsed?.error?.code !== 'json_validate_failed') return null
    return typeof parsed.error.failed_generation === 'string' ? parsed.error.failed_generation : ''
  } catch {
    return null
  }
}
