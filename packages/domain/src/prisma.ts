import { PrismaPg } from '@prisma/adapter-pg';
import {
  Client,
  type ClientConfig,
  type PoolConfig,
  type QueryConfig,
  type QueryResult,
  type Submittable,
} from 'pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

const DEFAULT_SCHEMA = 'public';
const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const DEFAULT_POOL_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 5_000;
const MILLISECONDS_PER_SECOND = 1_000;

type QueryInput = string | QueryConfig;
type QueryValues = QueryConfig['values'];
type QueryCallback = (error: Error | null, result?: QueryResult) => void;

function isSubmittable(query: QueryInput | Submittable): query is Submittable {
  return typeof query === 'object' && query !== null && 'submit' in query;
}

function createSchemaScopedClient(schema: string): new () => Client {
  const setLocalSearchPath = `SET LOCAL search_path TO "${schema}"`;
  return class SchemaScopedClient extends Client {
    private inTransaction = false;

    constructor(config?: string | ClientConfig) {
      super(config);
    }

    private queryDirect(
      query: QueryInput,
      values?: QueryValues,
    ): Promise<QueryResult> {
      return values === undefined
        ? super.query(query)
        : super.query(query, values);
    }

    private async discard(): Promise<void> {
      await this.end().catch(() => undefined);
    }

    private async rollbackOrDiscard(): Promise<void> {
      try {
        await this.queryDirect('ROLLBACK');
      } catch {
        await this.discard();
      }
    }

    private async queryWithSchema(
      query: QueryInput,
      values?: QueryValues,
    ): Promise<QueryResult> {
      const querySql = typeof query === 'string' ? query : query.text;
      if (querySql === 'BEGIN') {
        const result = await this.queryDirect(query, values);
        try {
          await this.queryDirect(setLocalSearchPath);
          this.inTransaction = true;
        } catch (error) {
          await this.rollbackOrDiscard();
          throw error;
        }
        return result;
      }
      if (this.inTransaction) {
        try {
          return await this.queryDirect(query, values);
        } catch (error) {
          if (querySql === 'COMMIT' || querySql === 'ROLLBACK') {
            await this.discard();
          }
          throw error;
        } finally {
          if (querySql === 'COMMIT' || querySql === 'ROLLBACK') {
            this.inTransaction = false;
          }
        }
      }

      await this.queryDirect('BEGIN');
      try {
        await this.queryDirect(setLocalSearchPath);
        const result = await this.queryDirect(query, values);
        await this.queryDirect('COMMIT');
        return result;
      } catch (error) {
        await this.rollbackOrDiscard();
        throw error;
      }
    }

    query = ((
      query: QueryInput | Submittable,
      valuesOrCallback?: QueryValues | QueryCallback,
      callback?: QueryCallback,
    ) => {
      const callbackFn =
        typeof valuesOrCallback === 'function' ? valuesOrCallback : callback;
      const values =
        typeof valuesOrCallback === 'function' ? undefined : valuesOrCallback;
      const result = isSubmittable(query)
        ? Promise.reject(
            new Error('PrismaPg adapter does not support Submittable queries'),
          )
        : this.queryWithSchema(query, values);
      if (!callbackFn) {
        return result;
      }
      void Promise.resolve(result).then(
        (value) => callbackFn(null, value as QueryResult),
        (error: unknown) =>
          callbackFn(error instanceof Error ? error : new Error(String(error))),
      );
    }) as Client['query'];
  };
}

export { Prisma, PrismaClient };
export type * from './generated/prisma/client.js';

export type PrismaAdapter = PrismaPg;

/**
 * Create the pg driver adapter while retaining the repository's URL semantics.
 * The URL is passed unchanged to pg; Prisma's schema and pooling parameters are
 * read only to configure the equivalent adapter options.
 */
export function createPrismaAdapter(databaseUrl: string): PrismaAdapter {
  const parsedUrl = parseDatabaseUrl(databaseUrl);
  const schema = parsedUrl.searchParams.get('schema') ?? DEFAULT_SCHEMA;
  const connectionLimit = parsePositiveInteger(parsedUrl, 'connection_limit');
  const poolTimeout = parseTimeoutMilliseconds(parsedUrl, 'pool_timeout');
  const connectTimeout = parseTimeoutMilliseconds(parsedUrl, 'connect_timeout');
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(
      'DATABASE_URL schema must be a simple PostgreSQL identifier',
    );
  }

  const usesTransactionScopedSchema =
    parsedUrl.searchParams.get('pgbouncer') === 'true';
  // PostgreSQL 15 does not report search_path changes, so PgBouncer cannot
  // safely track the startup option across transaction leases. The official
  // pg Client hook below applies SET LOCAL after BEGIN instead. Standalone
  // queries therefore incur one explicit BEGIN/SET LOCAL/COMMIT sequence;
  // migration URLs intentionally remain direct and keep the startup option.
  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    ...(usesTransactionScopedSchema
      ? { Client: createSchemaScopedClient(schema) }
      : { options: `-c search_path="${schema}"` }),
  };
  if (connectionLimit !== undefined) {
    poolConfig.max = connectionLimit;
  }

  // pg exposes one timer for both establishing a connection and waiting for a
  // pool slot. Preserve Prisma's 0=disabled semantics where possible, and use
  // Prisma's documented 5s/10s defaults instead of inheriting pg's indefinite
  // timer when the URL omits both values. If the two independent Prisma
  // timers differ, the stricter positive bound is the safe shared timer.
  const poolTimeoutBound =
    poolTimeout === 0
      ? undefined
      : (poolTimeout ?? DEFAULT_POOL_TIMEOUT_MILLISECONDS);
  const connectTimeoutBound =
    connectTimeout === 0
      ? undefined
      : (connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MILLISECONDS);
  if (poolTimeoutBound === undefined) {
    if (connectTimeoutBound !== undefined) {
      poolConfig.connectionTimeoutMillis = connectTimeoutBound;
    }
  } else if (connectTimeoutBound === undefined) {
    poolConfig.connectionTimeoutMillis = poolTimeoutBound;
  } else {
    poolConfig.connectionTimeoutMillis = Math.min(
      poolTimeoutBound,
      connectTimeoutBound,
    );
  }

  return new PrismaPg(poolConfig, { schema });
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const resolvedUrl = databaseUrl ?? process.env.DATABASE_URL?.trim();
  if (!resolvedUrl) {
    throw new Error('DATABASE_URL is required to create PrismaClient');
  }
  return new PrismaClient({ adapter: createPrismaAdapter(resolvedUrl) });
}

function parseDatabaseUrl(databaseUrl: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    parsedUrl.protocol !== 'postgresql:' &&
    parsedUrl.protocol !== 'postgres:'
  ) {
    throw new Error(
      'DATABASE_URL must use the postgresql:// or postgres:// scheme',
    );
  }
  return parsedUrl;
}

function parsePositiveInteger(url: URL, parameter: string): number | undefined {
  const rawValue = url.searchParams.get(parameter);
  if (rawValue === null) {
    return undefined;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`DATABASE_URL ${parameter} must be a positive integer`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`DATABASE_URL ${parameter} must be a positive integer`);
  }
  return value;
}

function parseTimeoutMilliseconds(
  url: URL,
  parameter: string,
): number | undefined {
  const rawValue = url.searchParams.get(parameter);
  if (rawValue === null) {
    return undefined;
  }
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`DATABASE_URL ${parameter} must be a non-negative integer`);
  }
  const seconds = Number(rawValue);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds > Math.floor(Number.MAX_SAFE_INTEGER / MILLISECONDS_PER_SECOND)
  ) {
    throw new Error(`DATABASE_URL ${parameter} is too large`);
  }
  return seconds * MILLISECONDS_PER_SECOND;
}
