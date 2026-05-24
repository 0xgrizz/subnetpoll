#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ignoredDirs = new Set([".git", "node_modules", ".next", "dist", "build"]);
const ignoredFiles = new Set(["scripts/check-secrets.mjs"]);
const textExtensions = new Set([
  ".css",
  ".csv",
  ".env",
  ".example",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".svg",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

const discordTokenPattern = new RegExp([
  "[A-ZMN][A-Za-z0-9_-]{20,}",
  "\\.",
  "[A-Za-z0-9_-]{6,}",
  "\\.",
  "[A-Za-z0-9_-]{20,}"
].join(""), "g");

const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g;
const findings = [];

await scan(root);

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.kind}`);
  }
  process.exit(1);
}

console.log("No token-like secrets found.");

async function scan(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        await scan(join(dir, entry.name));
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const path = join(dir, entry.name);
    const file = relative(root, path);
    if (ignoredFiles.has(file)) continue;
    if (!isTextFile(entry.name)) continue;

    const content = await readFile(path, "utf8");
    collectMatches(file, content, discordTokenPattern, "Discord token-like string");
    collectMatches(file, content, privateKeyPattern, "private key block");
  }
}

function isTextFile(file) {
  if (file === "CNAME" || file === "_headers") return true;
  const dot = file.lastIndexOf(".");
  if (dot === -1) return false;
  return textExtensions.has(file.slice(dot));
}

function collectMatches(file, content, pattern, kind) {
  pattern.lastIndex = 0;
  let match = pattern.exec(content);

  while (match) {
    findings.push({
      file,
      line: getLineNumber(content, match.index),
      kind
    });
    match = pattern.exec(content);
  }
}

function getLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}
