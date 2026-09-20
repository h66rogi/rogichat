"""Test-only compiled-manifest text; no fixture is included in the product."""
import unittest
from android_associations import verify_callback_manifest


def manifest(host="qa.rogi.chat"):
    return f'''E: manifest (line=1)
  E: application (line=2)
    E: activity (line=3)
      A: http://schemas.android.com/apk/res/android:name(0x01010003)="chat.rogi.rogichat.MainActivity" (Raw: "chat.rogi.rogichat.MainActivity")
      A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true
      E: intent-filter (line=4)
        A: http://schemas.android.com/apk/res/android:autoVerify(0x010104ee)=true
        E: action (line=5)
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.VIEW"
        E: category (line=6)
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.category.DEFAULT"
        E: category (line=7)
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.category.BROWSABLE"
        E: data (line=8)
          A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="https"
          A: http://schemas.android.com/apk/res/android:host(0x01010028)="{host}"
          A: http://schemas.android.com/apk/res/android:path(0x0101002a)="/mobile/auth/complete"
'''


class PackagedCallbackTests(unittest.TestCase):
    def test_exact_environment_filters(self):
        verify_callback_manifest(manifest(), "qa")
        verify_callback_manifest(manifest("rogi.chat"), "prod")
        with self.assertRaises(ValueError):
            verify_callback_manifest(manifest("rogi.chat"), "qa")

    def test_unverified_broad_or_wrong_activity_filters_rejected(self):
        for before, after in (("autoVerify(0x010104ee)=true", "autoVerify(0x010104ee)=false"),
                              ('="https"', '="http"'), ('path(0x0101002a)', 'pathPrefix(0x0101002b)'),
                              ('="/mobile/auth/complete"', '="/"'), (".MainActivity", ".OtherActivity"),
                              ("exported(0x01010010)=true", "exported(0x01010010)=false"),
                              ("android.intent.category.BROWSABLE", "android.intent.category.DEFAULT")):
            with self.subTest(before=before):
                with self.assertRaises(ValueError):
                    verify_callback_manifest(manifest().replace(before, after), "qa")

    def test_duplicate_or_missing_filter_and_unrelated_metadata_rejected(self):
        for text in ("", manifest() + manifest(), manifest().replace("E: intent-filter", "E: meta-data")):
            with self.assertRaises(ValueError):
                    verify_callback_manifest(text, "qa")

    def test_disabled_or_permission_gated_component_cannot_receive_browser_return(self):
        for element, depth in (("application (line=2)", 4), ("activity (line=3)", 6)):
            for attribute in ('enabled(0x0101000e)=false', 'permission(0x01010006)="private.permission"'):
                with self.subTest(element=element, attribute=attribute):
                    line = " " * depth + "A: http://schemas.android.com/apk/res/android:" + attribute
                    text = manifest().replace("E: " + element, "E: " + element + "\n" + line)
                    with self.assertRaises(ValueError):
                        verify_callback_manifest(text, "qa")


if __name__ == "__main__":
    unittest.main()
