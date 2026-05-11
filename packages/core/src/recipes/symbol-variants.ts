/**
 * Convert SQL identifiers (typically snake_case) to the camelCase variants that
 * ORM mapping layers expose to application code, and back. Used to widen the
 * cross-reference search net.
 */

export function camelize(input: string): string {
  if (!input) return input;
  const parts = input.split(/[_\s-]+/).filter(Boolean);
  if (parts.length === 0) return input;
  const head = parts[0]?.toLowerCase() ?? "";
  const tail = parts
    .slice(1)
    .map(
      (p) => (p[0]?.toUpperCase() ?? "") + p.slice(1).toLowerCase(),
    );
  return head + tail.join("");
}

export function snakeize(input: string): string {
  if (!input) return input;
  // camelCase -> snake_case
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function pascalize(input: string): string {
  const camel = camelize(input);
  if (!camel) return camel;
  return (camel[0]?.toUpperCase() ?? "") + camel.slice(1);
}
