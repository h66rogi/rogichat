# Publication source-owner snapshot verification

2026-09-20; runtime baseline `fcd03ef855c5d8369087ddb86b2bf821f3a0d2f9`.
The suspected repeatable-read source-owner bypass was **not reproduced**.
This change adds isolated regression coverage and evidence, with no runtime,
schema, migration, authentication, deletion or worker-loop changes.

## Existing authoritative gate

`PublicationsCoreService.sourceForOwner` calls `MessagesCoreService.load` using
the same writable transaction that accepts or finalizes a publication.
`MessagesRepository.load` has distinct read-only and writable branches. The
writable branch uses a joined `SELECT ... FOR UPDATE`, including
`users u ON u.id=m.content_owner_user_id`, and returns `u.status` as
`content_owner_status`. Consequently the status used by `canPublishSource` is a
current locking read, not the older Prisma snapshot established by candidate
lookup. `DELETING` and `DELETED` block publication. This gate is also reached
through `photoContext` before allocating independent destinations and before
marking them READY and publishing them.

The existing SQL exception supplies current rows and locks held through the
protected mutation. Ordinary test fixture CRUD uses Prisma. No extra SQL gate,
second runtime pool or alternate persistence implementation is introduced.
Room-owner publication capability remains separate from ordinary read grants;
this work does not change message anonymity, DTOs or the external-I/O boundary.

## Reproduction and results

`apps/api/test/integration/publication-owner-fence.test.mjs` uses the real Nest
domain graph and two database instances connected only to the disposable local
MySQL harness. For each test:

1. Transaction A confirms `REPEATABLE-READ` and reads the source owner's ACTIVE
   status through Prisma, establishing its snapshot.
2. Transaction B proves a different `CONNECTION_ID()`, changes that owner to
   DELETING, and commits while A remains open.
3. A reads ACTIVE again through Prisma, proving the old snapshot still exists,
   then invokes the actual protected operation.

| Operation in A | Observed result on unchanged runtime |
| --- | --- |
| Request, including current publisher session/CSRF validation | NOT_FOUND; no publication row |
| Text publication | REVOKED; no public copy, event, audit or counter advance |
| Photo allocation | REVOKED; no destination allocation or public copy |
| Photo finalization after prior allocation | REVOKED; existing destination marked DELETING; no public copy, event, audit or counter advance |

The focused disposable-MySQL run passed all four cases. The finalization test
uses synthetic metadata only in the test fixture; it tests the transactional
publication boundary and does not claim to validate object storage or decoding.
The standard `node test/run-mysql.mjs` discovers this new test automatically.

## Local validation

Using Node 24.21.0, pnpm 12.4.2 and MySQL 8.0.44:

- API build, lint and typecheck passed.
- Focused disposable-MySQL execution: 4/4 passed against unchanged runtime.
- Full `node test/run-mysql.mjs`: 179/179 passed, no skipped tests.
- Combined unit, contracts and end-to-end execution: 270/270 passed, no skips.
- The test/document-only diff changes no runtime symbols, client contracts,
  dependencies or deployment configuration; existing publication anonymity and
  separate owner-capability regressions passed in the full integration run.

## Limits and remaining work

No lock-order refactor is justified by this absent snapshot defect. Existing
HTTP authentication locks the publisher before entering publication core;
workers lock the publisher, then room/publication, and the shared message
loader takes its joined source-owner lock while loading the source. This report
does **not** assert that all account/domain acquisition paths have a globally
sorted account order or are deadlock-free. A future account deletion/purge
implementation must review that topology, preserve domain-before-job fencing,
and test contention independently rather than infer it from these four cases.

This is not an ACCOUNT deletion/purge implementation, physical removal proof,
backup/restore proof, QA deployment or production deployment. No QA, production,
cloud or shared-database writes were performed. Required remote CI and current-QA
integration remain PR gates, distinct from the local reproduction result.
