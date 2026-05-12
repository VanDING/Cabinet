import Database from 'better-sqlite3';

let db: Database.Database | null = null;

/**
 * 创建或获取 SQLite 连接。
 * 仅在首次调用时创建连接，后续调用返回同一实例（单例模式）。
 * 自动启用 WAL 模式和 foreign_keys。
 */
export function createConnection(path: string): Database.Database {
  if (db) return db;

  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * 获取当前连接。如果未初始化则抛出错误。
 */
export function getConnection(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call createConnection() first.');
  }
  return db;
}

/**
 * 关闭数据库连接。
 */
export function closeConnection(): void {
  if (db) {
    db.close();
    db = null;
  }
}
