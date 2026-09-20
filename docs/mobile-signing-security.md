# QA iOS keychain unlock

The local QA release tool keeps the existing optional `ios.keychain` and
`ios.keychain_password_file` configuration. Both paths must resolve outside Git
repositories. The password must be in a current-user-owned regular file with mode
`0600`; its maximum size is 4096 bytes. The UTF-8 password file convention trims
surrounding ASCII whitespace, including the usual trailing newline. Empty and
NUL-containing passwords are rejected.

Archive, export and explicitly invoked upload unlock only the configured existing
keychain through macOS Security.framework. The password is read directly into a
mutable memory buffer and passed in process to `SecKeychainUnlock`, with an
explicit keychain reference and password length. It never enters a command line,
environment variable, shell, standard input or release log. The buffer is erased
on both success and failure. This reduces exposure; it does not promise protection
against a compromised release process or privileged memory inspection.

Unlock suppresses optional keychain UI during the call and restores the previous
process setting afterwards. A wrong password, unavailable API, invalid password
file or locked result stops the release; there is no insecure command fallback.
An already unlocked keychain stays usable. The tool does not alter the default
keychain, search list, signing identities, ACLs or persistent locking settings.
As before, a successfully unlocked signing keychain remains available for the
following signing commands and its existing automatic locking policy applies.

The ABI is verified against Apple's macOS SDK `Security/SecKeychain.h` and
[Apple's implementation](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecKeychain.cpp).
The file-based SecKeychain APIs are deprecated by Apple but remain the API used
for this existing dedicated signing-keychain workflow. They are loaded from
absolute system framework paths; unsupported systems fail before release work.

Run credential-free regressions with:

```sh
python3 -m unittest discover -s tools/mobile -p 'test_*.py'
```

On an authorized local Mac, the following additional test creates a disposable
keychain in a private temporary directory using a synthetic password. It verifies
unlock, repeated unlock, wrong-password failure, recovery, deletion, and unchanged
default keychain/search list. It never reads real signing passwords and makes no
upload or network request. This test is opt-in and does not run in normal CI.

```sh
ROGICHAT_TEST_DISPOSABLE_KEYCHAIN=1 python3 tools/mobile/test_keychain_unlock.py
```
