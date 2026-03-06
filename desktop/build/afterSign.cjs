// Re-sign the .app bundle with a consistent ad-hoc identity.
// Without this, macOS rejects the app at launch because the main binary
// (ad-hoc signed by electron-builder) and the Electron Framework
// (signed by Electron's team) have different Team IDs.
const { execSync } = require("child_process");
const path = require("path");

module.exports = async function afterPack(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`[afterPack] Re-signing ${appPath} with ad-hoc identity...`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, {
    stdio: "inherit",
  });
  console.log(`[afterPack] Re-signing complete.`);
};
