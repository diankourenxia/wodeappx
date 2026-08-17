export function controlOptionalStringArgument(args: unknown, name: string): string {
  if (!args || typeof args !== "object" || !(name in args)) return "";
  const value = (args as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

export function controlOptionalBooleanArgument(args: unknown, name: string, fallback = false): boolean {
  if (!args || typeof args !== "object" || !(name in args)) return fallback;
  const value = (args as Record<string, unknown>)[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
}

/**
 * Models (esp. MiniMax) often emit arrays as `{ item: [...] }` / `{ items: [...] }`
 * or as a single URL string. Normalize those into a real string[] so downstream
 * actions receive usable image lists instead of failing type checks.
 */
export function normalizeStringArrayInput(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          for (const key of ["url", "imageUrl", "href", "src", "value"]) {
            if (typeof record[key] === "string" && record[key].trim()) return String(record[key]).trim();
          }
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["item", "items", "urls", "images", "productImages", "imageUrls", "value"]) {
      if (key in record) {
        const nested = normalizeStringArrayInput(record[key]);
        if (nested.length) return nested;
      }
    }
    if (typeof record.url === "string" && record.url.trim()) return [record.url.trim()];
  }
  return [];
}

export function controlOptionalStringArrayArgument(args: unknown, name: string): string[] {
  if (!args || typeof args !== "object" || !(name in args)) return [];
  return normalizeStringArrayInput((args as Record<string, unknown>)[name]);
}

export function controlOptionalRecordArrayArgument(args: unknown, name: string): Record<string, unknown>[] {
  if (!args || typeof args !== "object" || !(name in args)) return [];
  const value = (args as Record<string, unknown>)[name];
  if (!Array.isArray(value)) {
    // Same MiniMax wrap: { item: [ {...}, ... ] }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["item", "items", "value"]) {
        if (Array.isArray(record[key])) {
          return record[key].filter(
            (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
          );
        }
      }
    }
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
  );
}
