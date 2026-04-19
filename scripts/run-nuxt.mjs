#!/usr/bin/env node
import { spawn } from "node:child_process";

const SUPPRESS_PATTERNS = [
  /Duplicated imports "useAppConfig"/,
  /Circular dependency:.*nitropack\/dist\/runtime/,
  /Circular dependency:.*@nuxt\/nitro-server\/dist\/runtime/,
];

const cmd = process.argv[2];
if (!cmd) {
  console.error("Usage: run-nuxt.mjs <dev|build|preview>");
  process.exit(1);
}

const child = spawn("nuxt", [cmd, ...process.argv.slice(3)], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

function makeFilter(out) {
  let carry = "";
  let skipUntilBlank = false;

  return (chunk) => {
    const text = carry + chunk.toString();
    const lines = text.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      if (skipUntilBlank) {
        if (line.trim() === "") skipUntilBlank = false;
        continue;
      }
      if (SUPPRESS_PATTERNS.some((re) => re.test(line))) {
        skipUntilBlank = true;
        continue;
      }
      out.write(`${line}\n`);
    }
  };
}

child.stdout.on("data", makeFilter(process.stdout));
child.stderr.on("data", makeFilter(process.stderr));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
