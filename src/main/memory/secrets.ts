// Credential guard: memories must never contain API keys, passwords, tokens,
// or other secrets — whatever the user (or the extractor model) tries to
// store. Conservative pattern checks; a rejected memory is simply not stored
// and the refusal is reported honestly.

const SECRET_PATTERNS: RegExp[] = [
  // Named credentials with a value: "my password is hunter2", "api key: x"
  /\b(password|passphrase|passwd|pin code|pin)\b\s*(is|:|=)\s*\S+/i,
  /\b(api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|client[\s_-]?secret|private[\s_-]?key)\b\s*(is|:|=)?\s*\S*/i,
  // Well-known token shapes
  /\bsk-[A-Za-z0-9_-]{16,}\b/, // OpenAI/Groq-style
  /\bgsk_[A-Za-z0-9_-]{16,}\b/, // Groq
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/, // GitHub
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i,
  /\beyJ[A-Za-z0-9_-]{14,}\.[A-Za-z0-9._-]{14,}/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Long high-entropy blobs (hex/base64 runs) that look like keys
  /\b[A-Fa-f0-9]{40,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/
]

/** True when the text looks like it contains a credential/secret. */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}
