// Existing Firebase CLI login only. The caller captures stdout; never log tokens.
const fs = require('node:fs');
const path = require('node:path');

async function session(binary) {
  let root = path.dirname(fs.realpathSync(binary));
  for (let depth = 0; depth < 6; depth++, root = path.dirname(root)) {
    const file = path.join(root, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.name !== 'firebase-tools') continue;
    // The CLI does not expose a general REST command. Keep this internal adapter
    // narrow and fail closed if an installed CLI changes its authentication API.
    const auth = require(path.join(root, 'lib/auth.js'));
    const account = auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw new Error('Missing CLI login');
    const token = await auth.getAccessToken(account.tokens.refresh_token,
      ['https://www.googleapis.com/auth/cloud-platform']);
    if (typeof token.access_token !== 'string' || !token.access_token
        || token.access_token === account.tokens.refresh_token) throw new Error('Missing access token');
    return token.access_token;
  }
  throw new Error('Unsupported Firebase CLI installation');
}

if (require.main === module) {
  session(process.argv[2]).then(token => process.stdout.write(JSON.stringify({access_token: token})))
    .catch(() => { process.stderr.write('Firebase CLI authentication unavailable; check local login and CLI installation.\n'); process.exitCode = 1; });
}
module.exports = { session };
