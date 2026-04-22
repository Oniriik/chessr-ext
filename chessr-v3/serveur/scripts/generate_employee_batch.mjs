#!/usr/bin/env node
/**
 * Offline batch generator for license employee keys.
 *
 * Run this on a SECURE machine (your laptop, NOT the production server) and
 * upload the resulting JSON to the server's `LICENSE_EMPLOYEES_PATH`. The
 * master private key NEVER touches the production server — it stays on this
 * machine (or in a hardware token).
 *
 * Each employee:
 *   - Has its own Ed25519 keypair (used to sign actual grants on the server)
 *   - Has a "certificate" = master signature over { pubkey, validity, id }
 *
 * The WASM client verifies the certificate chain on every grant: the master
 * pubkey is baked in the WASM, the employee pubkey is taken from the
 * certificate, the grant is verified against the employee pubkey.
 *
 * Usage:
 *   node generate_employee_batch.mjs \
 *     --master /secure/path/license_master.pem \
 *     --year 2026 \
 *     --window 3600 \
 *     --out employees_2026.json
 *
 *   --window: lifetime of each employee in seconds (default 3600 = 1 hour)
 *   --year:   calendar year covered by the batch
 *   --start:  override start time (ISO date or unix_ms; default = year start UTC)
 *   --end:    override end time   (default = year end UTC)
 *
 * The same master pubkey hex is also printed at the end — paste it into
 * maia2-wasm/patricia-build/wasm/build.sh's MASTER_PUBLIC_KEY_HEX env var.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  generateKeyPairSync, createPrivateKey, sign, createPublicKey,
} from 'node:crypto';

// ─── Args ──────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, _, i, arr) => {
    if (arr[i].startsWith('--')) acc.push([arr[i].slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

if (!args.master || !args.out) {
  console.error('Usage: node generate_employee_batch.mjs --master <pem> --out <json> [--year YYYY] [--window seconds] [--start <iso>] [--end <iso>]');
  process.exit(1);
}

const windowSec = parseInt(args.window ?? '3600', 10);
const windowMs = windowSec * 1000;

const year = args.year ? parseInt(args.year, 10) : new Date().getUTCFullYear();
const startMs = args.start
  ? (isNaN(+args.start) ? new Date(args.start).getTime() : +args.start)
  : Date.UTC(year, 0, 1, 0, 0, 0);
const endMs = args.end
  ? (isNaN(+args.end) ? new Date(args.end).getTime() : +args.end)
  : Date.UTC(year + 1, 0, 1, 0, 0, 0);

const total = Math.ceil((endMs - startMs) / windowMs);
console.error(`Generating ${total} employees for window=${windowSec}s, range=${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);

// ─── Master key ────────────────────────────────────────────────────────
const masterPem = readFileSync(args.master, 'utf8');
const masterKey = createPrivateKey(masterPem);
// Extract the 32 raw public-key bytes from the matching public key (DER tail)
const masterPubDer = createPublicKey(masterKey).export({ type: 'spki', format: 'der' });
const masterPubBytes = masterPubDer.subarray(masterPubDer.length - 32);
const masterPubHex = Buffer.from(masterPubBytes).toString('hex');
const masterPubB64 = base64urlEncode(masterPubBytes);

// ─── Generate batch ────────────────────────────────────────────────────
const employees = [];
for (let i = 0; i < total; i++) {
  const validFromMs = startMs + i * windowMs;
  const validToMs = validFromMs + windowMs;

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const employeePubDer = publicKey.export({ type: 'spki', format: 'der' });
  const employeePubBytes = employeePubDer.subarray(employeePubDer.length - 32);
  const employeePubB64 = base64urlEncode(employeePubBytes);
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  // Certificate payload signed by master.
  const certPayload = JSON.stringify({
    pubkey: employeePubB64,
    from: validFromMs,
    to: validToMs,
    id: i + 1,
  });
  const certPayloadBytes = Buffer.from(certPayload, 'utf8');
  const masterSig = sign(null, certPayloadBytes, masterKey);
  const certificateB64 = base64urlEncode(Buffer.concat([masterSig, certPayloadBytes]));

  employees.push({
    id: i + 1,
    private_key_pem: privateKeyPem,
    certificate_b64: certificateB64,
    valid_from_ms: validFromMs,
    valid_to_ms: validToMs,
  });

  if ((i + 1) % 1000 === 0) {
    console.error(`  ${i + 1}/${total} signed`);
  }
}

// ─── Write output ──────────────────────────────────────────────────────
const out = {
  master_pubkey_b64: masterPubB64,
  hour_window_ms: windowMs,
  generated_at: new Date().toISOString(),
  start_ms: startMs,
  end_ms: endMs,
  employees,
};
writeFileSync(args.out, JSON.stringify(out));

const sizeMB = (Buffer.byteLength(JSON.stringify(out)) / 1e6).toFixed(1);
console.error(`\n✓ Wrote ${total} employees to ${args.out} (${sizeMB} MB)`);
console.error(`\nMaster public key for the WASM build:`);
console.error(`  MASTER_PUBLIC_KEY_HEX=${masterPubHex}`);
console.error(`\nNext steps:`);
console.error(`  1. scp ${args.out} root@VPS:/opt/chessr/license/`);
console.error(`  2. Set on the server: LICENSE_EMPLOYEES_PATH=/opt/chessr/license/${args.out}`);
console.error(`  3. Restart serveur`);
console.error(`  4. (Once) bake the master pubkey into the WASM:`);
console.error(`       cd maia2-wasm/patricia-build/wasm`);
console.error(`       MASTER_PUBLIC_KEY_HEX=${masterPubHex} ./build.sh`);

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
