import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../src/lib/crypto.js";

describe("crypto", () => {
  it("encrypts and decrypts a string", () => {
    const plaintext = "test-access-token-12345";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same input (random IV)", () => {
    const plaintext = "same-input";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
    // But both decrypt to the same value
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it("encrypted format is iv:authTag:ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext is present
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("throws on invalid encrypted data format", () => {
    expect(() => decrypt("not-valid")).toThrow("Invalid encrypted data format");
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("handles long strings", () => {
    const long = "x".repeat(10000);
    const encrypted = encrypt(long);
    expect(decrypt(encrypted)).toBe(long);
  });

  it("handles unicode", () => {
    const unicode = "Hello \u{1F600} World \u{1F4A9} Unicode \u{2603}";
    const encrypted = encrypt(unicode);
    expect(decrypt(encrypted)).toBe(unicode);
  });
});
