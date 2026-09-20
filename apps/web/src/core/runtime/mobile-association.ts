/** Verified public QA signing identities. Production identities are not approved. */
const QA_IOS_APP_ID = 'FS9YQ9URFY.chat.rogi.rogichat.qa';
const QA_ANDROID_PACKAGE = 'chat.rogi.rogichat.qa';
const QA_ANDROID_CERTIFICATE = '41:D9:B6:25:2C:D7:F4:C0:73:D5:4E:2E:35:72:D4:DA:8D:53:31:5C:43:7B:CE:62:31:CB:57:41:9F:27:0F:D7';
export const MOBILE_CALLBACK_PATH = '/mobile/auth/complete';
export function appleAssociation(environment: 'qa' | 'production') {
  return {
    applinks: { details: environment === 'qa' ? [{ appIDs: [QA_IOS_APP_ID], components: [{ '/': MOBILE_CALLBACK_PATH }] }] : [] },
    webcredentials: { apps: environment === 'qa' ? [QA_IOS_APP_ID] : [] },
  };
}
export function androidAssociation(environment: 'qa' | 'production') {
  return environment === 'qa' ? [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: QA_ANDROID_PACKAGE, sha256_cert_fingerprints: [QA_ANDROID_CERTIFICATE] },
    relation_extensions: { 'delegate_permission/common.handle_all_urls': { dynamic_app_link_components: [{ '/': MOBILE_CALLBACK_PATH }, { '/': '*', exclude: true }] } },
  }] : [];
}
