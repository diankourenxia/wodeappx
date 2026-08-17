export type WodeAppRuntimeDataRecord = Record<string, unknown>;

function asRecord(value: unknown): WodeAppRuntimeDataRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as WodeAppRuntimeDataRecord;
}

function responseError(payload: WodeAppRuntimeDataRecord | null): string {
  const error = payload?.error;
  return typeof error === "string" && error.trim() ? error.trim() : "response did not confirm success";
}

/**
 * Runtime data endpoints use a business-level `success` flag in addition to
 * HTTP status. Treat empty, malformed and `success !== true` responses as
 * failures so a workbench URL is never opened from an unconfirmed write.
 */
export function requireSuccessfulRuntimeDataResponse(
  payload: unknown,
  operation: string,
): WodeAppRuntimeDataRecord {
  const response = asRecord(payload);
  if (!response || response.success !== true) {
    throw new Error(`${operation} failed: ${responseError(response)}`);
  }
  return response;
}

export function requireRuntimeDataMutationRecord(
  payload: unknown,
  operation: string,
): WodeAppRuntimeDataRecord {
  const response = requireSuccessfulRuntimeDataResponse(payload, operation);
  const data = asRecord(response.data);
  if (!data) throw new Error(`${operation} failed: response data is missing or invalid`);
  return data;
}

export function requireRuntimeDataQueryRecords(
  payload: unknown,
  operation: string,
): WodeAppRuntimeDataRecord[] {
  const response = requireSuccessfulRuntimeDataResponse(payload, operation);
  const data = asRecord(response.data);
  if (!data || !Array.isArray(data.records)) {
    throw new Error(`${operation} failed: response records are missing or invalid`);
  }
  if (data.records.some((record) => !asRecord(record))) {
    throw new Error(`${operation} failed: response contains an invalid record`);
  }
  return data.records as WodeAppRuntimeDataRecord[];
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalValue(item === undefined ? null : item)).join(",")}]`;
  }
  const record = asRecord(value);
  if (record) {
    return `{${Object.entries(record)
      // JSON request bodies drop undefined object properties. Readback must use
      // the same semantics or optional task fields create a false mismatch.
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Compare JSON payloads without depending on object key order. */
export function runtimeDataPayloadMatches(expected: unknown, actual: unknown): boolean {
  return canonicalValue(expected) === canonicalValue(actual);
}

export function runtimeDataRecordId(record: WodeAppRuntimeDataRecord): string {
  for (const candidate of [record._recordId, record.id, record.docId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}
