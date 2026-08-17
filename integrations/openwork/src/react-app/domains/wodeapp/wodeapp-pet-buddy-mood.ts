/** Idle this long before the perch pet curls up to sleep. */
export const PET_BUDDY_SLEEP_AFTER_MS = 18_000;

/** Visual mood driven by selected-session status (and click react). */
export type WodeAppPetBuddyMood = "idle" | "watch" | "sleep" | "react";

export function isPetBuddyInProgressStatus(status: string | undefined): boolean {
  if (!status || status === "idle") return false;
  return true;
}

/**
 * Cheap mood resolver — no timers here.
 * Prefer `asleep` (one-shot timeout) over ticking `idleForMs` every second.
 */
export function resolvePetBuddyMood(args: {
  reacting: boolean;
  selectedStatus: string | undefined;
  /** True after a single sleep timeout fires. */
  asleep?: boolean;
  /** Legacy/test path: elapsed idle ms. Avoid driving this from a 1s setState loop. */
  idleForMs?: number;
  sleepAfterMs?: number;
}): WodeAppPetBuddyMood {
  if (args.reacting) return "react";
  if (isPetBuddyInProgressStatus(args.selectedStatus)) return "watch";
  if (args.asleep) return "sleep";
  const sleepAfter = args.sleepAfterMs ?? PET_BUDDY_SLEEP_AFTER_MS;
  if (typeof args.idleForMs === "number" && args.idleForMs >= sleepAfter) return "sleep";
  return "idle";
}
