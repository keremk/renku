// Re-sign the .app bundle with a consistent ad-hoc identity.
// Without this, macOS rejects the app at launch because the main binary
// (ad-hoc signed by electron-builder) and the Electron Framework
// (signed by Electron's team) have different Team IDs.
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  if (process.env.RENKU_DESKTOP_SIGN === '1') {
    assertProductionSigning(appPath);
    console.log(
      '[afterSign] Production signing mode enabled. Keeping existing signature.'
    );
    return;
  }

  console.log(`[afterSign] Re-signing ${appPath} with ad-hoc identity...`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, {
    stdio: 'inherit',
  });
  console.log(`[afterSign] Re-signing complete.`);
};

function assertProductionSigning(appPath) {
  const signingInfo = execSync(`codesign -dv --verbose=4 "${appPath}" 2>&1`, {
    encoding: 'utf8',
  });

  const teamIdentifierMatch = signingInfo.match(/^TeamIdentifier=(.+)$/m);
  if (!teamIdentifierMatch) {
    throw new Error(
      '[afterSign] Production signing validation failed: TeamIdentifier is missing.'
    );
  }

  const teamIdentifier = teamIdentifierMatch[1].trim();
  if (teamIdentifier === '' || teamIdentifier === 'not set') {
    throw new Error(
      '[afterSign] Production signing validation failed: app is ad-hoc signed (TeamIdentifier=not set). Configure Developer ID signing before running package:prod.'
    );
  }
}
