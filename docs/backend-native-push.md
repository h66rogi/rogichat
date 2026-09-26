# Native push: APNs and FCM

This extends M11 with APNs HTTP/2 and FCM HTTP v1 senders. Source and isolated
test success are not deployment, credential provisioning, device receipt or OS
notification presentation evidence. Missing configuration is explicitly
unavailable; no product fixtures or synthetic success are installed.

## Client contract

All routes require native Bearer plus `X-Rogi-Client`. Cookies, Origin, CSRF
headers, query parameters and non-JSON mutation bodies are rejected. Responses
are no-store. iOS uses `APNS`; Android uses `FCM`. Web Push remains separate.

| Method/path | Input | Success |
| --- | --- | --- |
| GET `/v1/me/native-push-capabilities` | none | `{available,provider}` |
| POST `/v1/me/native-push-subscriptions` | `{provider,token,installationId,bindingSecret,generation?}` | 201 `{id,generation}` |
| POST `/v1/me/native-push-subscriptions/resolve` | `{installationId,bindingSecret}` | `{binding:null}` or `{binding:{id,generation,revoked}}` |
| DELETE `/v1/me/native-push-subscriptions/:id` | `{generation,bindingSecret}` | 204, no body |

Registration and capabilities require verified SOOP and accepted current terms.
Resolve/removal remain available with current authentication when provider
credentials are unavailable. Registration does not enable preferences; the user
separately enables their own preference using its current generation.

OFF→ON uses existing `PUT /v1/me/notification-preferences` with
`{pushEnabled:true,expectedGeneration}` from the latest GET. The mobile client
must obtain actual OS permission, register the current installation, then send
this explicit user choice. The server verifies current terms/SOOP/provider and
an active subscription bound to this same session/account generation on the write
transaction; missing/stale binding returns 409. The backend cannot independently
query OS permission and accepts no client permission boolean as proof. Disable
remains available without provider configuration. Registration alone never opts in.

Persist a random UUIDv4 installation ID and independently random 32-byte secret
in OS secure storage **before** the initial request. Use separate QA/production
values; retain them across account changes. These are not hardware IDs. Secret:
canonical unpadded base64url, 43 characters. Generations: positive uint64 decimal
strings. APNs tokens: lowercase hex of 16–128 bytes. FCM grammar/bounds are in
OpenAPI. No token, secret or previous account/session is echoed.

Initial registration omits generation. A lost-response retry returns the same
receipt only for the exact active token/session/account-generation binding.
Token rotation and session/account rebind require the current generation and
increment it. The same installation secret permits explicit A→B→A changes;
preferences and old message intents never transfer. Resolve after timeout,
conflict or cold restart; never guess or locally increment generations. An
unknown COMMIT result cannot authorize replay of an internal transaction.

Removal requires the current owning session, secret and generation. It increments
generation and erases token ciphertext. An exact lost-ACK retry observes the
same-session revoked next generation only. Old requests cannot revoke replacements.
Logout/expiry immediately prevent enqueue/send through session checks. The
20-active-installation quota excludes revoked/expired sessions; historical rows
remain subject to account cleanup. Losing installation custody cannot authorize
token takeover: a token collision from another installation conflicts. Preserve
the secure record and never report successful enrollment after conflict.

## Persistence and concurrency

Existing `push_subscriptions` gains provider (default WEB), native client,
installation UUID (unique), SHA-256 installation proof and encrypted native
token. Web credential columns become nullable; existing WEB rows and constraints
remain. Ordinary access uses generated Prisma; bound SQL is reserved for current
row locks and existing queue fences.

AES-256-GCM uses a fresh nonce and authenticated audience/subscription/generation.
A domain-separated hash binds token uniqueness to audience/client/provider.
Existing session/user FKs, delivery generations and bounded deletion are reused.
Cross-account rebind locks the prior account NOWAIT after locking the new one,
avoiding inverse cycles. Contention is failure, not successful registration;
recover the opaque receipt before retrying.

Fanout, enqueue and final dispatch match provider/client/session together.
Discovery does not authorize sending. Current account, SOOP, session, preferences,
membership, message/source visibility, subscription generation and job lease are
rechecked. Prepare/OAuth/DNS/provider I/O stays outside DB transactions; final
dispatch rechecks after preparation. Late provider rejection invalidates only
the attempted generation. Account cleanup removes jobs/deliveries before native
credentials/sessions according to current ownership. In-flight wakes cannot be
recalled; clients always resync using their current authenticated account.

## Private provider configuration

API and worker load `PUSH_NATIVE_SECRET_FILE` at startup. Omission disables native
providers; an invalid supplied file fails startup with a generic error. Supply a
canonical absolute regular-file path, no symlink components, one hard link, owner
root or process EUID, exact mode 0400/0600, strict UTF-8 flat JSON up to 16 KiB.
Duplicate/escaped/unknown field names, environment mismatch and incomplete groups
are rejected. The non-root runtime UID must be able to read it. Keep credentials
outside public Git, images, public CI and logs; use the private operator workflow.
For the UID 10001 runtime, provision **UID 10001-owned mode 0400** and mount
read-only in API and worker only. The existing root:10001 mode 0440 convention
for other credentials is not accepted by this loader; do not assume a fallback.

Required: `environment` exactly matching APP_ENV; `encryptionKey` (32 random bytes
as 64 lowercase hex characters). At least one complete group:

- APNs: `apnsTeamId`, `apnsKeyId`, `apnsPrivateKey` (P-256 PKCS8 PEM), `apnsTopic`,
  `apnsEnvironment` (`sandbox` or `production`). QA does not imply sandbox;
  distribution-signed QA apps can use production APNs.
- FCM: `fcmProjectId`, `fcmClientEmail`, `fcmPrivateKey` (RSA >=2048-bit PEM),
  `fcmApplicationId`. Project, permissions and installed app configuration must
  agree. Configuration presence is not a delivery test.

API/worker require the same encryption key/configuration. Signing-key changes need
a controlled restart. Encryption-key replacement needs a reviewed re-enrollment
or migration plan; blind replacement makes stored tokens undecryptable. No keys
or operational credential values belong in this document.

Transport uses fixed Google OAuth/FCM and Apple APNs hosts, rejects non-public DNS
answers, pins the inspected address while validating TLS against the hostname,
and follows no redirects. DNS deadline: 2s; request deadline: 5s; response limit:
16 KiB. Shutdown destroys active requests and clears cached Google access tokens.
Do not log provider bodies, tokens or secret files.

APNs signs ES256 tokens and sends a priority-10 alert with a generic Rogichat
title/body, sound, `content-available:1` and a 60-second expiry. FCM uses signed
service-account OAuth then data `{type:"sync_required",version:"1"}`, Android
high priority, 60-second TTL and configured package restriction. Android displays
the same generic local notification after validating the data-only wake. Both
coalesce using `rogi-sync`. Clients normalize version representation. There are
no message text, identifiers or signed URLs in provider payloads. Provider
acceptance is not device receipt or proof that the user read the alert.

References: [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api),
[FCM message contract](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages),
[APNs tokens](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
[APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).

## Verification boundary

Tests cover generated signing keys/signatures, strict secret files, encryption
AAD, fixed DNS, HTTP/2 socket construction and provider classification. OpenAPI
checks the actual controller graph. Disposable MySQL scenarios cover account
switching, stale DELETE/provider replies, concurrent CAS, native message fanout
and dispatch, post-prepare revocation, quota recovery and credential cleanup.
These fixtures never enter product code.

The native provider migration was generated with Prisma on an isolated MySQL
8.0.44 instance and all 23 migrations were replayed successfully into a second
empty database. The bounded native/WebPush preferences, fanout and delivery
integration suite passed 54 tests, including final-dispatch personal-block
checks; fixture teardown was confirmed on 2026-09-20. The focused unit/OpenAPI/
schema suite passed 40 tests. These are local integration results, not real
provider delivery or deployment evidence.

Activation requires genuine migration generation/fresh replay, required CI and
security checks, immutable API/worker releases, privately provisioned credentials
and real OS registration/delivery observations. Until observed, QA/production
device/provider verification is pending—not simulated completion.
