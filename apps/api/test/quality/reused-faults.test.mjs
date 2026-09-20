// Reuse the real API egress proxy/SIGKILL and purge transaction barriers. Their
// assertions execute here unchanged and remain individually named in TAP output.
import '../integration/messages-crash.test.mjs';
import '../integration/message-purge-crash.test.mjs';
import '../integration/deletion-replay.test.mjs';
import '../integration/account-deletion.test.mjs';
import '../integration/realtime.test.mjs';
