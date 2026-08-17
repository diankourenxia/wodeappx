import { z } from "zod";

import {
  WODEAPP_DIRECT_ACTION_CONTRACTS,
  directActionInputSchemaToRendererArgs,
  type WodeAppDirectActionContract,
  type WodeAppJsonSchema,
  type WodeAppJsonSchemaType,
  type WodeAppRendererActionArg,
} from "./wodeapp-direct-action-contracts.js";
import {
  assertXlsProductSaveAllowed,
  type WodeAppToolExecutionContext,
} from "./wodeapp-xls-save-gate.js";

export type WodeAppUiBridgeRequestOptions = {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
};

export type WodeAppUiBridgeRequest = (
  path: string,
  options?: WodeAppUiBridgeRequestOptions,
) => Promise<unknown>;

export type WodeAppDirectToolDefinition = {
  description: string;
  args: z.ZodRawShape;
  execute: (args: unknown, context?: WodeAppToolExecutionContext) => Promise<string>;
};

export type WodeAppLiveUiAction = {
  id: string;
  label?: string;
  description?: string;
  effect?: unknown;
  approval?: unknown;
  args?: unknown;
  disabled?: boolean;
  [key: string]: unknown;
};

export const WODEAPP_UI_ACTION_UNAVAILABLE = "__wodeapp_ui_action_unavailable__";

const DIRECT_ACTION_IDS = new Set<string>(
  WODEAPP_DIRECT_ACTION_CONTRACTS.map((contract) => contract.actionId),
);

function unionSchemas(options: readonly z.ZodType[]): z.ZodType {
  if (options.length === 0) return z.never();
  if (options.length === 1) return options[0];
  return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function literalSchema(value: string | number | boolean | null): z.ZodType {
  if (value === null) return z.null();
  return z.literal(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function jsonObjectShape(schema: WodeAppJsonSchema): z.ZodRawShape {
  const required = new Set(schema.required ?? []);
  // Zod 4 treats ZodRawShape's index signature as readonly; build through a mutable map.
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
    let property = jsonSchemaToZod(propertySchema);
    if (!required.has(name)) property = property.optional();
    shape[name] = property;
  }
  for (const name of required) {
    if (!(name in shape)) shape[name] = z.unknown();
  }
  return shape;
}

function jsonObjectSchemaToZod(schema: WodeAppJsonSchema): z.ZodType {
  const required = new Set(schema.required ?? []);
  let objectSchema = z.object(jsonObjectShape(schema));

  if (schema.additionalProperties === false) {
    objectSchema = objectSchema.strict();
  } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    objectSchema = objectSchema.catchall(jsonSchemaToZod(schema.additionalProperties));
  } else {
    objectSchema = objectSchema.passthrough();
  }

  if (required.size === 0) return objectSchema;
  return objectSchema.superRefine((value, context) => {
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(value, name) || value[name] === undefined) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: "Required",
        });
      }
    }
  });
}

function schemaForType(type: WodeAppJsonSchemaType, schema: WodeAppJsonSchema): z.ZodType {
  if (type === "object") return jsonObjectSchemaToZod(schema);
  if (type === "array") {
    let arraySchema = z.array(schema.items ? jsonSchemaToZod(schema.items) : z.unknown());
    if (schema.minItems !== undefined) arraySchema = arraySchema.min(schema.minItems);
    if (schema.maxItems !== undefined) arraySchema = arraySchema.max(schema.maxItems);
    if (schema.uniqueItems) {
      return arraySchema.superRefine((items, context) => {
        const seen = new Set<string>();
        for (let index = 0; index < items.length; index += 1) {
          const key = canonicalJson(items[index]);
          if (seen.has(key)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "Array items must be unique",
            });
          }
          seen.add(key);
        }
      });
    }
    return arraySchema;
  }
  if (type === "string") {
    let stringSchema = z.string();
    if (schema.minLength !== undefined) stringSchema = stringSchema.min(schema.minLength);
    if (schema.maxLength !== undefined) stringSchema = stringSchema.max(schema.maxLength);
    return stringSchema;
  }
  if (type === "integer") {
    let numberSchema = z.number().int();
    if (schema.minimum !== undefined) numberSchema = numberSchema.min(schema.minimum);
    if (schema.maximum !== undefined) numberSchema = numberSchema.max(schema.maximum);
    return numberSchema;
  }
  if (type === "number") {
    let numberSchema = z.number();
    if (schema.minimum !== undefined) numberSchema = numberSchema.min(schema.minimum);
    if (schema.maximum !== undefined) numberSchema = numberSchema.max(schema.maximum);
    return numberSchema;
  }
  if (type === "boolean") return z.boolean();
  if (type === "null") return z.null();
  return z.unknown();
}

function inferredBaseSchema(schema: WodeAppJsonSchema): z.ZodType {
  const declaredTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (declaredTypes.length > 0) {
    return unionSchemas(declaredTypes.map((type) => schemaForType(type, schema)));
  }
  if (schema.properties || schema.required || schema.additionalProperties !== undefined) {
    return jsonObjectSchemaToZod(schema);
  }
  if (schema.items) return schemaForType("array", schema);
  return z.unknown();
}

/** Convert the contract's JSON-like schema recursively into the Zod schema OpenCode executes. */
export function jsonSchemaToZod(schema: WodeAppJsonSchema): z.ZodType {
  let result = inferredBaseSchema(schema);

  if (schema.enum) {
    result = z.intersection(result, unionSchemas(schema.enum.map(literalSchema)));
  }
  if (schema.const !== undefined) {
    result = z.intersection(result, literalSchema(schema.const));
  }
  if (schema.anyOf?.length) {
    const alternatives = schema.anyOf.map(jsonSchemaToZod);
    result = result.superRefine((value, context) => {
      if (!alternatives.some((alternative) => alternative.safeParse(value).success)) {
        context.addIssue({
          code: "custom",
          message: "Expected at least one schema match",
        });
      }
    });
  }
  if (schema.oneOf?.length) {
    const alternatives = schema.oneOf.map(jsonSchemaToZod);
    result = result.superRefine((value, context) => {
      const matches = alternatives.filter((alternative) => alternative.safeParse(value).success).length;
      if (matches !== 1) {
        context.addIssue({
          code: "custom",
          message: `Expected exactly one schema match, received ${matches}`,
        });
      }
    });
  }
  for (const item of schema.allOf ?? []) {
    const constraint = jsonSchemaToZod(item);
    result = result.superRefine((value, context) => {
      if (!constraint.safeParse(value).success) {
        context.addIssue({
          code: "custom",
          message: "Expected all schema constraints to match",
        });
      }
    });
  }
  if (schema.description) result = result.describe(schema.description);
  if (schema.default !== undefined) result = result.default(schema.default as never);
  return result;
}

function actionArray(payload: unknown): WodeAppLiveUiAction[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { actions?: unknown }).actions)
      ? (payload as { actions: unknown[] }).actions
      : [];
  return source.filter((item): item is WodeAppLiveUiAction => (
    Boolean(item)
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof (item as { id?: unknown }).id === "string"
    && Boolean((item as { id: string }).id.trim())
  ));
}

/** The generic UI tool only exposes live, enabled actions that have no direct model tool. */
export function modelVisibleUiActions(payload: unknown): WodeAppLiveUiAction[] {
  const seen = new Set<string>();
  return actionArray(payload).filter((action) => {
    if (action.disabled === true || DIRECT_ACTION_IDS.has(action.id) || seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

/** JSON Schema for the remaining generic UI executor. It is closed even when no action is live. */
export function buildUiExecuteActionJsonSchema(payload: unknown): WodeAppJsonSchema {
  const actions = modelVisibleUiActions(payload);
  const actionIds = actions.length > 0
    ? actions.map((action) => action.id)
    : [WODEAPP_UI_ACTION_UNAVAILABLE];
  return {
    type: "object",
    properties: {
      actionId: { type: "string", enum: actionIds },
      args: { type: "object" },
    },
    required: ["actionId"],
    additionalProperties: false,
  };
}

function rendererTypeMatches(type: WodeAppRendererActionArg["type"], value: unknown): boolean {
  if (type === undefined || type === "unknown") return true;
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return false;
}

/**
 * Soften common model typing slips before hard-failing:
 * - durationSec: "15" → 15
 * - productImages: { item: ["https://..."] } → ["https://..."]
 * - productImages: "https://a,https://b" → ["https://a","https://b"]
 * Unknown keys are stripped below — do not invent values for missing required fields.
 */
export function coerceRendererArgumentValue(
  type: WodeAppRendererActionArg["type"],
  value: unknown,
): unknown {
  if (value === undefined || value === null) return value;
  if (rendererTypeMatches(type, value)) return value;
  if (type === "number" && typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return value;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (type === "boolean" && typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1") return true;
    if (trimmed === "false" || trimmed === "0") return false;
  }
  if (type === "array") {
    const normalized = normalizeCoercedStringArray(value);
    if (normalized !== null) return normalized;
  }
  return value;
}

/** Best-effort array unwrap for UI action validation (kept local to avoid circular imports). */
function normalizeCoercedStringArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parts = value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
    return parts.length ? parts : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["item", "items", "urls", "images", "productImages", "imageUrls", "value", "scenes", "subjects"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
      if (typeof record[key] === "string" && record[key].trim()) {
        return [String(record[key]).trim()];
      }
    }
    if (typeof record.url === "string" && record.url.trim()) return [record.url.trim()];
  }
  return null;
}

/** Validate a generic UI action against the same live catalog used to build its enum. */
export function assertUiActionInvocation(
  payload: unknown,
  actionId: string,
  args: unknown,
): Record<string, unknown> {
  const action = modelVisibleUiActions(payload).find((candidate) => candidate.id === actionId);
  if (!action) throw new Error(`UI action is not model-visible: ${actionId}`);

  const values = args === undefined || args === null
    ? {}
    : args;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(`Invalid arguments for UI action ${actionId}: expected an object.`);
  }
  const record = values as Record<string, unknown>;
  const definitions = Array.isArray(action.args)
    ? action.args.filter((argument): argument is WodeAppRendererActionArg => (
      Boolean(argument)
      && typeof argument === "object"
      && typeof (argument as { name?: unknown }).name === "string"
    ))
    : [];
  const byName = new Map(definitions.map((argument) => [argument.name, argument]));
  // Models often pass optional extras (aspectRatio, productInfo, …) that are
  // documented in prose or present on a sibling action. Strip unknowns instead
  // of failing the whole call — required fields are still enforced below.
  const normalized: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(record)) {
    const definition = byName.get(name);
    if (!definition) continue;
    normalized[name] = coerceRendererArgumentValue(definition.type, raw);
  }
  const missing = definitions.filter((argument) => (
    argument.required === true
    && (!Object.prototype.hasOwnProperty.call(normalized, argument.name) || normalized[argument.name] === undefined)
  ));
  if (missing.length > 0) {
    throw new Error(`Invalid arguments for UI action ${actionId}: ${missing.map((item) => item.name).join(", ")} required.`);
  }
  for (const argument of definitions) {
    const value = normalized[argument.name];
    if (value !== undefined && !rendererTypeMatches(argument.type, value)) {
      throw new Error(`Invalid arguments for UI action ${actionId}: ${argument.name} must be ${argument.type ?? "unknown"}.`);
    }
  }
  return normalized;
}

type ComparableRendererArg = Pick<WodeAppRendererActionArg, "name" | "type" | "required">;

function comparableRendererArgs(value: unknown): ComparableRendererArg[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: ComparableRendererArg[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") return null;
    const argument = item as WodeAppRendererActionArg;
    result.push({
      name: argument.name,
      type: argument.type ?? "unknown",
      required: argument.required === true,
    });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function rendererArgTypesCompatible(
  left: WodeAppRendererActionArg["type"] | undefined,
  right: WodeAppRendererActionArg["type"] | undefined,
): boolean {
  const normalizedLeft = left ?? "unknown";
  const normalizedRight = right ?? "unknown";
  if (normalizedLeft === "unknown" || normalizedRight === "unknown") return true;
  return normalizedLeft === normalizedRight;
}

/**
 * Exact arg-list equality was too brittle for staggered desktop/plugin rebuilds:
 * adding optional fields like model/modelId would fail-closed before /execute.
 * Keep fail-closed for required-set and overlapping type mismatches; allow
 * additive optional args on either side (unknowns are stripped at invoke time).
 */
function assertCompatibleDirectActionArgs(
  actionId: string,
  expectedArgs: ComparableRendererArg[],
  actualArgs: ComparableRendererArg[],
): void {
  const expectedByName = new Map(expectedArgs.map((argument) => [argument.name, argument]));
  const actualByName = new Map(actualArgs.map((argument) => [argument.name, argument]));
  const problems: string[] = [];

  for (const expected of expectedArgs) {
    if (!expected.required) continue;
    const actual = actualByName.get(expected.name);
    if (!actual) {
      problems.push(`missing required live arg ${expected.name}`);
      continue;
    }
    if (!actual.required) {
      problems.push(`live arg ${expected.name} must stay required`);
    }
    if (!rendererArgTypesCompatible(expected.type, actual.type)) {
      problems.push(`live arg ${expected.name} type ${String(actual.type)} != ${String(expected.type)}`);
    }
  }

  for (const actual of actualArgs) {
    if (!actual.required) continue;
    const expected = expectedByName.get(actual.name);
    if (!expected) {
      problems.push(`live requires ${actual.name} but direct contract does not expose it`);
      continue;
    }
    if (!expected.required) {
      problems.push(`direct contract arg ${actual.name} must be required to match live`);
    }
    if (!rendererArgTypesCompatible(expected.type, actual.type)) {
      problems.push(`contract arg ${actual.name} type ${String(expected.type)} != live ${String(actual.type)}`);
    }
  }

  for (const expected of expectedArgs) {
    if (expected.required) continue;
    const actual = actualByName.get(expected.name);
    if (!actual) continue;
    if (!rendererArgTypesCompatible(expected.type, actual.type)) {
      problems.push(`optional arg ${expected.name} type drift: contract ${String(expected.type)} vs live ${String(actual.type)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Direct action contract drift for ${actionId}: ${problems.join("; ")}.`);
  }
}

function assertLiveDirectActionContract(payload: unknown, contract: WodeAppDirectActionContract): void {
  const matches = actionArray(payload).filter((action) => action.id === contract.actionId);
  if (matches.length !== 1) {
    throw new Error(`Direct action ${contract.actionId} is ${matches.length === 0 ? "not live" : "registered more than once"}.`);
  }
  const action = matches[0];
  if (action.disabled === true) throw new Error(`Direct action ${contract.actionId} is disabled.`);
  if (action.effect !== contract.effect) {
    throw new Error(`Direct action contract drift for ${contract.actionId}: effect ${String(action.effect)} != ${contract.effect}.`);
  }
  // Approval is enforced by the live renderer registry. Requiring an exact
  // match here made harmless write-policy rollouts fail whenever the desktop
  // renderer and the bundled server plugin were rebuilt at different times.
  // Destructive actions are the exception: both sides must fail closed on a
  // prompt so a stale bundle can never turn deletion into an automatic action.
  if (contract.effect === "destructive" && contract.approval !== "prompt") {
    throw new Error(`Unsafe direct action contract for ${contract.actionId}: destructive actions require prompt approval.`);
  }
  if (action.effect === "destructive" && action.approval !== "prompt") {
    throw new Error(`Unsafe live direct action ${contract.actionId}: destructive actions require prompt approval.`);
  }

  const actualArgs = comparableRendererArgs(action.args);
  const expectedArgs = comparableRendererArgs(directActionInputSchemaToRendererArgs(contract.inputSchema));
  if (!actualArgs || !expectedArgs) {
    throw new Error(`Direct action contract drift for ${contract.actionId}: renderer arguments are malformed.`);
  }
  assertCompatibleDirectActionArgs(contract.actionId, expectedArgs, actualArgs);
}

export type BuildWodeAppDirectToolsOptions = {
  bridgeRequest: WodeAppUiBridgeRequest;
  contracts?: readonly WodeAppDirectActionContract[];
  executeTimeoutMs?: number;
};

/** Build one OpenCode tool per direct contract. actionId is captured and never model input. */
export function buildWodeAppDirectTools({
  bridgeRequest,
  contracts = WODEAPP_DIRECT_ACTION_CONTRACTS,
  executeTimeoutMs = 10 * 60_000,
}: BuildWodeAppDirectToolsOptions): Record<string, WodeAppDirectToolDefinition> {
  const definitions: Record<string, WodeAppDirectToolDefinition> = {};
  const actionIds = new Set<string>();
  for (const contract of contracts) {
    if (definitions[contract.toolName]) throw new Error(`Duplicate WodeApp direct tool name: ${contract.toolName}`);
    if (actionIds.has(contract.actionId)) throw new Error(`Duplicate WodeApp direct action id: ${contract.actionId}`);
    if (Object.prototype.hasOwnProperty.call(contract.inputSchema.properties, "actionId")) {
      throw new Error(`Direct tool ${contract.toolName} must not expose actionId.`);
    }
    actionIds.add(contract.actionId);

    const inputSchema = jsonSchemaToZod(contract.inputSchema);
    const args = jsonObjectShape(contract.inputSchema);
    definitions[contract.toolName] = {
      description: contract.description,
      args,
      async execute(rawArgs: unknown, context?: WodeAppToolExecutionContext) {
        const parsedArgs = inputSchema.parse(rawArgs);
        if (contract.toolName === "wodeapp_product_save") {
          assertXlsProductSaveAllowed(context);
        }
        const liveActions = await bridgeRequest("/actions");
        assertLiveDirectActionContract(liveActions, contract);
        const callerSessionId = typeof context?.sessionID === "string" ? context.sessionID.trim() : "";
        const result = await bridgeRequest("/execute", {
          method: "POST",
          body: {
            actionId: contract.actionId,
            args: parsedArgs,
            ...(callerSessionId ? { sessionId: callerSessionId } : {}),
          },
          timeoutMs: executeTimeoutMs,
        });
        return JSON.stringify(result, null, 2);
      },
    };
  }
  return definitions;
}

export const buildWodeAppDirectToolDefinitions = buildWodeAppDirectTools;
