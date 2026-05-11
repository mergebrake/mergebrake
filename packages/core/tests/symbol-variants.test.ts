import { describe, expect, it } from "vitest";
import { camelize, snakeize, pascalize } from "../src/recipes/symbol-variants.js";

describe("camelize / snakeize / pascalize", () => {
  it("camelize snake_case", () => {
    expect(camelize("full_name")).toBe("fullName");
    expect(camelize("created_at_utc")).toBe("createdAtUtc");
  });
  it("camelize is idempotent on already-camel", () => {
    expect(camelize("fullName")).toBe("fullname"); // splits only on _ or whitespace
  });
  it("snakeize camelCase", () => {
    expect(snakeize("fullName")).toBe("full_name");
    expect(snakeize("createdAtUtc")).toBe("created_at_utc");
  });
  it("snakeize already snake", () => {
    expect(snakeize("full_name")).toBe("full_name");
  });
  it("pascalize", () => {
    expect(pascalize("full_name")).toBe("FullName");
  });
});
