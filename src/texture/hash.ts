export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function hashBytes(bytes: Uint8Array | Uint8ClampedArray): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const step = Math.max(1, Math.floor(bytes.length / 16384));
  for (let i = 0; i < bytes.length; i += step) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ bytes[i], 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  h1 ^= bytes.length;
  h2 ^= bytes.length;
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function hashNumbers(values: number[], seed = 0x811c9dc5): string {
  let h1 = seed >>> 0;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number.isFinite(values[i]) ? Math.round(values[i] * 100000) : 0x7fffffff;
    h1 ^= value;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ value, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}
