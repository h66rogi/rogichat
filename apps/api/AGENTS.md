# Backend implementation principles

These rules apply together with the repository's public-repository and QA PR gates.

- Use generated Prisma Client operations for ordinary reads, relations, creates,
  updates, conditional updates and deletes. Consider relation filters, nested
  writes and `updateMany` before choosing SQL. Do not implement a second runtime
  database pool or an alternative SQL-first persistence layer.
- Raw SQL is an individual exception, not a repository-wide default. Record the
  concrete need, such as current-row locking, `SKIP LOCKED`, a DB-clock atomic
  expression, or ACL-before-LIMIT pagination. Use bound values and fixed trusted
  identifiers. Never use `$queryRawUnsafe` or `$executeRawUnsafe`.
- Pass the existing transaction into repositories. Fresh authorization and the
  protected mutation must use the same transaction; repositories must not open
  hidden transactions. Storage, broker and decoder I/O stays outside it.
- Select only needed fields explicitly. Generated database models and raw rows
  are not response DTOs. Preserve viewer-specific projections and UUID-based
  identifiers; never expose internal keys, account/provider identifiers or
  private profile data through object spreading.
- Implement features as Nest modules with injected controllers, services and
  private repositories. Controllers own HTTP concerns; services own use cases;
  repositories own persistence. Cross-feature calls use exported service ports,
  not another feature's private repository. Keep `src` root for composition and
  entry points, and let Nest lifecycle hooks own runtime resource shutdown.
- Preserve transaction deadlines, read-only snapshots, lock ordering, deletion
  fences and idempotency while refactoring. Retry only classified failures with
  confirmed rollback; an unknown COMMIT result must not replay a command.
- Treat generated output as build artifacts. Verify from a clean build, including
  deployment scripts that import compiled modules, before publishing changes.

See `../../docs/backend-orm-first.md` for the data-access decision and exception
inventory, and `../../docs/backend-nestjs-architecture-correction.md` for module
ownership and verification evidence.
