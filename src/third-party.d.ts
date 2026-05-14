declare module "pg" {
  export interface QueryResult<Row = unknown> {
    rows: Row[];
  }

  export interface PoolClient {
    query<Row = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(options: { connectionString: string });
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}

declare module "umzug" {
  export interface RunnableMigration<Context = unknown> {
    name: string;
    up: (params: { context: Context }) => Promise<void> | void;
    down?: (params: { context: Context }) => Promise<void> | void;
  }

  export class Umzug<Context = unknown> {
    constructor(options: {
      context: Context;
      migrations: RunnableMigration<Context>[];
      storage: {
        executed(): Promise<string[]>;
        logMigration(params: { name: string }): Promise<void>;
        unlogMigration(params: { name: string }): Promise<void>;
      };
      logger?: unknown;
    });
    up(): Promise<void>;
    executed(): Promise<Array<{ name: string }>>;
    pending(): Promise<Array<{ name: string }>>;
  }
}
