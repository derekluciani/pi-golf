import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageValue = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const declaredRange = packageValue?.engines?.node;

if (typeof declaredRange !== "string") {
  throw new Error("package.json must declare engines.node.");
}

const minimumMatch = /^>=(\d+)\.(\d+)\.(\d+)$/u.exec(declaredRange);
if (minimumMatch === null) {
  throw new Error("engines.node must be one exact inclusive minimum such as >=22.19.0.");
}

const minimum = minimumMatch.slice(1).map(Number);
const current = process.versions.node.split(".").slice(0, 3).map(Number);
if (minimum.length !== 3 || current.length !== 3 || [...minimum, ...current].some(Number.isNaN)) {
  throw new Error("Unable to parse the declared or current Node version.");
}

let versionComparison = 0;
for (let index = 0; index < minimum.length; index += 1) {
  const currentPart = current[index];
  const minimumPart = minimum[index];
  if (currentPart === undefined || minimumPart === undefined || currentPart === minimumPart) continue;
  versionComparison = currentPart > minimumPart ? 1 : -1;
  break;
}

if (versionComparison < 0) {
  throw new Error(`Pi Golf requires Node ${declaredRange}; current runtime is ${process.versions.node}.`);
}
