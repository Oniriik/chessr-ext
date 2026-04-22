/**
 * Hierarchical grant signer for the engine-license endpoint.
 *
 *   Master key (offline, in user's safe)
 *     └── signs Employee certificates (offline, batch-generated yearly)
 *           └── Employee signs per-request grants (online, on Hetzner)
 *
 * Master public key is baked into the WASM at build time. Employee keys
 * rotate every hour from a pre-signed batch; if one leaks, blast radius is
 * at most one hour.
 *
 * Wire format:
 *   {
 *     certificate:     base64url( master_sig[64] || cert_payload_utf8 )
 *     signed_response: base64url( employee_sig[64] || grant_payload_utf8 )
 *     expires_in: 60
 *   }
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

interface EmployeeRecord {
  id: number;
  private_key_pem: string;
  certificate_b64: string;
  valid_from_ms: number;
  valid_to_ms: number;
  _key?: KeyObject;
}

interface EmployeeBatch {
  master_pubkey_b64: string;
  hour_window_ms: number;
  employees: EmployeeRecord[];
}

let batch: EmployeeBatch | null = null;

function loadBatch(): EmployeeBatch {
  if (batch) return batch;
  const path = process.env.LICENSE_EMPLOYEES_PATH;
  if (!path) {
    throw new Error(
      "LICENSE_EMPLOYEES_PATH not set. Generate the batch with " +
        "scripts/generate_employee_batch.mjs and point this env at the JSON.",
    );
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as EmployeeBatch;
  if (!Array.isArray(parsed.employees) || parsed.employees.length === 0) {
    throw new Error("LICENSE_EMPLOYEES_PATH points to an empty/invalid batch");
  }
  batch = parsed;
  return parsed;
}

function pickEmployee(now: number): EmployeeRecord | null {
  const b = loadBatch();
  for (const e of b.employees) {
    if (now >= e.valid_from_ms && now < e.valid_to_ms) return e;
  }
  return null;
}

function base64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface GrantClaims {
  sub: string;
  engine: "patricia" | "maia2";
  nonce: string;
  exp: number;
  iat: number;
  iss: "chessr";
}

export interface SignedResponse {
  certificate: string;
  signed_response: string;
}

export function signGrant(claims: GrantClaims): SignedResponse {
  const now = Date.now();
  const employee = pickEmployee(now);
  if (!employee) {
    throw new Error(
      `License employee batch exhausted at ${new Date(now).toISOString()}`,
    );
  }
  if (!employee._key) {
    employee._key = createPrivateKey(
      employee.private_key_pem.includes("\\n")
        ? employee.private_key_pem.replace(/\\n/g, "\n")
        : employee.private_key_pem,
    );
  }
  const payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
  const signature = sign(null, payloadBytes, employee._key);
  const signed_response = base64urlEncode(
    Buffer.concat([signature, payloadBytes]),
  );
  return {
    certificate: employee.certificate_b64,
    signed_response,
  };
}

export function batchHealth(): {
  loaded: boolean;
  size?: number;
  current_id?: number;
  exhausted_in_ms?: number;
  invalid_in_ms?: number;
} {
  try {
    const b = loadBatch();
    const now = Date.now();
    const cur = pickEmployee(now);
    const last = b.employees[b.employees.length - 1];
    return {
      loaded: true,
      size: b.employees.length,
      current_id: cur?.id,
      exhausted_in_ms: last.valid_to_ms - now,
      invalid_in_ms: cur ? cur.valid_to_ms - now : 0,
    };
  } catch {
    return { loaded: false };
  }
}
