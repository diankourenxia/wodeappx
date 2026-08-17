import type { ModelRef } from "@/app/types";
import { modelEquals } from "@/app/utils";
import type { SessionChoiceOverride } from "@/react-app/kernel/model-config";

export type ResolvedSessionModelState = {
  model: ModelRef | null;
  variant: string | null;
};

export function resolveSessionModelState(
  defaultModel: ModelRef | null | undefined,
  defaultVariant: string | null | undefined,
  override: SessionChoiceOverride | null | undefined,
): ResolvedSessionModelState {
  return {
    model: override?.model ?? defaultModel ?? null,
    variant: override && Object.prototype.hasOwnProperty.call(override, "variant")
      ? override.variant ?? null
      : defaultVariant ?? null,
  };
}

export function selectSessionModel(
  current: ResolvedSessionModelState,
  nextModel: ModelRef,
): SessionChoiceOverride {
  return {
    model: nextModel,
    variant: current.model && modelEquals(current.model, nextModel)
      ? current.variant
      : null,
  };
}

export function selectSessionVariant(
  current: ResolvedSessionModelState,
  variant: string | null,
): SessionChoiceOverride {
  return {
    ...(current.model ? { model: current.model } : {}),
    variant,
  };
}
