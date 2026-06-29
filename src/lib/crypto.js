import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "buffer";
import argon2 from "argon2";
import { env } from "../config/env.js";

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

export function encryptCredential(plaintext) {
  if (!env.credentialEncryptionKey) throw new Error("Credential encryption is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", env.credentialEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptCredential(payload) {
  if (!env.credentialEncryptionKey) throw new Error("Credential encryption is not configured");
  const [version, ivValue, tagValue, encryptedValue] = String(payload || "").split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Unsupported encrypted credential format");
  const decipher = createDecipheriv("aes-256-gcm", env.credentialEncryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
