export type DatabaseFailure = 'database_admission' | 'database_acquisition' | 'database_statement_timeout' | 'transaction_timeout';

// Internal categories only: never serialize driver errors, SQL or connection data.
export class DatabaseUnavailableError extends Error {
  constructor(readonly reason: DatabaseFailure) { super(reason); }
}
