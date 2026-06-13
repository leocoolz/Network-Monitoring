import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1
});

export function createToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeTokenEqual(value, expectedHash) {
  if (typeof value !== "string" || typeof expectedHash !== "string") return false;
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
