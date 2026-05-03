#!/usr/bin/env node
// One-shot init container entrypoint: prisma migrate deploy against MySQL,
// retrying while the DB warms up.

const { execSync } = require("node:child_process");

const RETRIES = 30;
const DELAY_MS = 2_000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let lastErr;
for (let i = 1; i <= RETRIES; i++) {
  try {
    console.log(`[migrate] attempt ${i}/${RETRIES} – prisma migrate deploy`);
    execSync(
      "node node_modules/@dub/prisma/node_modules/prisma/build/index.js migrate deploy --schema=packages/prisma/schema/schema.prisma",
      { stdio: "inherit" },
    );
    console.log("[migrate] ok");
    process.exit(0);
  } catch (err) {
    lastErr = err;
    console.warn(`[migrate] failed, retrying in ${DELAY_MS}ms`);
    sleep(DELAY_MS);
  }
}

console.error("[migrate] giving up after", RETRIES, "attempts");
console.error(lastErr);
process.exit(1);
