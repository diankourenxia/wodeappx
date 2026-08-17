/**
 * Classify transient TLS / transport failures so SessionRetry can self-heal
 * instead of stopping on UnknownError (e.g. Bun "unknown certificate verification error").
 */

export const TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS = 8

const TRANSIENT_NETWORK_PATTERNS: RegExp[] = [
  /certificate verification/i,
  /unable to connect/i,
  /socket connection was closed/i,
  /connection reset/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /network\s*(error|unreachable|changed)/i,
  /\bTLS\b/i,
  /\bSSL\b/i,
  /CERT_/i,
  /SSLV3_ALERT/i,
]

export function isTransientNetworkErrorMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false
  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => pattern.test(message))
}

export function transientNetworkErrorMessage(error: Error): string {
  const raw = typeof error.message === "string" && error.message.trim() ? error.message.trim() : "Network error"
  if (/certificate verification/i.test(raw)) {
    return "TLS certificate verification failed"
  }
  if (/unable to connect/i.test(raw)) {
    return "Unable to connect to API"
  }
  if (/socket connection was closed/i.test(raw)) {
    return "Socket connection closed unexpectedly"
  }
  return raw
}
