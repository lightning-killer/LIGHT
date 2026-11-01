// Creates the database if it does not exist. Never drops anything.
import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

const { database, ...conn } = config.db;
if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('DB_NAME may only contain letters, digits and underscores');
const c = await mysql.createConnection(conn);
await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
console.log(`Database "${database}" is ready.`);
await c.end();
