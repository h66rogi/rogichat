import { Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown, Provider } from '@nestjs/common';
import { MysqlDatabase } from '../../database.js';
import type { Database } from '../../database.js';
import type { Config } from '../../config.js';
import { Transactions } from '../../transactions.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { DATABASE } from './database.tokens.js';

interface DatabaseModuleOptions {
  /** Production uses config; explicit database/transactions are test/composition overrides. */
  config?: Config;
  database?: Database;
  transactions?: Transactions;
  lifecycle?: LifecycleState;
  /** An injected fixture may retain ownership. Production connections always belong to Nest. */
  externallyOwned?: boolean;
}
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database, private readonly lifecycle: LifecycleState) {}
  async onApplicationShutdown(): Promise<void> { this.lifecycle.draining = true; await this.database.close(); }
}

@Module({})
export class DatabaseModule {
  static register(options: DatabaseModuleOptions): DynamicModule {
    if (Boolean(options.config) === Boolean(options.database) || (options.config && (options.externallyOwned || options.transactions))) throw new Error('invalid_database_module');
    if (options.database && 'transactions' in options.database && options.transactions && options.database.transactions !== options.transactions) throw new Error('invalid_database_module');
    const providers: Provider[] = [
      options.database ? { provide: DATABASE, useValue: options.database } : { provide: DATABASE, useFactory: () => new MysqlDatabase(options.config!) },
      options.lifecycle ? { provide: LifecycleState, useValue: options.lifecycle } : LifecycleState,
    ];
    const exports: DynamicModule['exports'] = [DATABASE, LifecycleState];
    const hasTransactions = options.transactions || options.config || (options.database && 'transactions' in options.database);
    if (hasTransactions) {
      providers.push(options.transactions ? { provide: Transactions, useValue: options.transactions } : {
        provide: Transactions, inject: [DATABASE], useFactory: (database: MysqlDatabase) => database.transactions,
      });
      exports.push(Transactions);
    }
    if (!options.externallyOwned) providers.push(DatabaseLifecycle);
    return { module: DatabaseModule, providers, exports };
  }
}
