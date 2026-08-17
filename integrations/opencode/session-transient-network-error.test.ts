import { describe, expect, test } from "bun:test"
import {
  TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS,
  isTransientNetworkErrorMessage,
  transientNetworkErrorMessage,
} from "./session-transient-network-error"

describe("session-transient-network-error", () => {
  test("recognizes certificate and connect failures", () => {
    expect(isTransientNetworkErrorMessage("unknown certificate verification error")).toBe(true)
    expect(isTransientNetworkErrorMessage("Unable to connect. Is the computer able to access the url?")).toBe(true)
    expect(isTransientNetworkErrorMessage("The socket connection was closed unexpectedly")).toBe(true)
    expect(isTransientNetworkErrorMessage("ECONNRESET")).toBe(true)
    expect(isTransientNetworkErrorMessage("积分不足")).toBe(false)
    expect(isTransientNetworkErrorMessage("ProviderModelNotFoundError")).toBe(false)
  })

  test("normalizes certificate messages", () => {
    expect(transientNetworkErrorMessage(new Error("unknown certificate verification error"))).toBe(
      "TLS certificate verification failed",
    )
  })

  test("exposes attempt budget", () => {
    expect(TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS).toBeGreaterThanOrEqual(3)
    expect(TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS).toBeLessThanOrEqual(20)
  })
})
