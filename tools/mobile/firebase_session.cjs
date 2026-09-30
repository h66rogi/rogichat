// Explicit ADC service identity only. Captured stdout is never a log or receipt.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function session(binary) {
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credential) throw new Error('Missing configured credentials');
  let root = path.dirname(fs.realpathSync(binary));
  for (let depth = 0; depth < 6; depth++, root = path.dirname(root)) {
    const file = path.join(root, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.name !== 'firebase-tools') continue;
    const { GoogleAuth } = createRequire(file)('google-auth-library');
    const auth = new GoogleAuth({ keyFile: credential, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (typeof token.token !== 'string' || !token.token || !Number.isFinite(client.credentials.expiry_date)) {
      throw new Error('Missing access token');
    }
    return { access_token: token.token, expiry_date: client.credentials.expiry_date };
  }
  throw new Error('Unsupported Firebase CLI installation');
}

if (require.main === module) {
  session(process.argv[2]).then(value => process.stdout.write(JSON.stringify(value)))
    .catch(() => { process.stderr.write('Firebase service account authentication unavailable.\n'); process.exitCode = 1; });
}
module.exports = { session };
