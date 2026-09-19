# QA point-in-time restore drill

Disabled by default. Independent backend: `rogichat/qa/restore-drill.tfstate`.
Never use the application backend. `enabled=true` plus an exact validated UTC
`restore_to_time` creates only a temporary Aurora cluster and private writer.

1. Insert a synthetic marker through the authorized QA operator connection.
2. Wait until source `LatestRestorableTime` includes the committed marker.
3. Review a saved plan containing exactly two creates, no source changes.
4. Restore into the existing private DB subnets/SG with the TLS-enforcing parameter
   group. Do not change DNS, apps, or source DB credentials.
5. Verify CA + hostname TLS, marker equality and restored runtime account grants.
   Record backup lag and restore-to-usable duration separately from application RTO.
6. Set `enabled=false`, review exactly two destroys and apply. Verify the temporary
   cluster/writer are absent and remove only the source synthetic marker/table.

Temporary compute is US$0.113 per writer-hour before discounts, plus storage/I/O.
RI availability is not assumed for the temporary second writer. No final snapshot
is retained for the disposable copy; the protected source and its backups remain.
No credentials, marker contents, endpoints, state or plan are written to Git.
