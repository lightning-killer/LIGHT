import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z', // all DATETIME values are stored/read as UTC
  charset: 'utf8mb4',
  dateStrings: false,
});

// Keep every connection in UTC so UTC_TIMESTAMP(), NOW() and JS Dates agree.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

/** Parameterized query helper. Never concatenate user input into sql. */
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function ping() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
