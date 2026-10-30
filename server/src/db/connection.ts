import mysql, {Pool, PoolConnection, RowDataPacket, ResultSetHeader} from 'mysql2/promise';
import env from '../env';

/**
 * Shared MySQL connection pool. Import `db` anywhere and call `db.query(...)`.
 */
export const pool: Pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  connectionLimit: env.db.connectionLimit,
  waitForConnections: true,
  namedPlaceholders: true,
  charset: 'utf8mb4',
});

type Params = Record<string, unknown> | unknown[];

export async function query<T extends RowDataPacket[]>(
  sql: string,
  params?: Params,
): Promise<T> {
  const [rows] = await pool.execute<T>(sql, params as never);
  return rows;
}

export async function execute(
  sql: string,
  params?: Params,
): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params as never);
  return result;
}

/** Run a set of statements inside a transaction. */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export type {RowDataPacket, ResultSetHeader};
