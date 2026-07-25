import { cp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PATCHED_VERSION = "5.0.8";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patchedPackage = resolve(projectRoot, "node_modules/brace-expansion");
const piPackageCopy = resolve(
  projectRoot,
  "node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion",
);

/** Reads and validates the installed package version used by this tooling patch. */
async function readInstalledVersion(packageDirectory) {
  const packageJson = JSON.parse(
    await readFile(resolve(packageDirectory, "package.json"), "utf8"),
  );

  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error(`Invalid package metadata in ${packageDirectory}`);
  }

  return packageJson.version;
}

// This workaround is only for this repository's development install. npm also
// runs postinstall when consumers install the packed extension, where Pi and
// the patched package are intentionally absent because they are dev-only.
const installOrigin = process.env.INIT_CWD;
const isRootDevelopmentInstall =
  typeof installOrigin === "string" && resolve(installOrigin) === projectRoot;

if (isRootDevelopmentInstall) {
  const installedPatchedVersion = await readInstalledVersion(patchedPackage);
  if (installedPatchedVersion !== PATCHED_VERSION) {
    throw new Error(
      `Expected brace-expansion ${PATCHED_VERSION}, found ${installedPatchedVersion}`,
    );
  }

  // Pi 0.82.1 ships a shrinkwrap that installs vulnerable 5.0.7 despite the
  // compatible ^5.0.5 range. Replace that nested copy with the pinned patched
  // package until Pi publishes a corrected shrinkwrap.
  await rm(piPackageCopy, { force: true, recursive: true });
  await cp(patchedPackage, piPackageCopy, { recursive: true });
}
