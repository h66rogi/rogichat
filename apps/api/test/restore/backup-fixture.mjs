// Reuses the logical backup/restore implementation from quality/a-restore.test.mjs.
// Every identifier comes from this disposable fixture or SHOW TABLES, never a caller target.
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
export const identifier = value => { assert.match(value, /^[A-Za-z0-9_]+$/); return `\`${value}\``; };
export async function backup(admin) {
  await admin.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await admin.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  try {
    const [tables] = await admin.query('SHOW TABLES'), dump = [];
    for (const row of tables) {
      const name = Object.values(row)[0], [definition] = await admin.query(`SHOW CREATE TABLE ${identifier(name)}`);
      const [rows] = await admin.query(`SELECT * FROM ${identifier(name)}`);
      dump.push({ name, ddl: definition[0]['Create Table'], rows });
    }
    await admin.commit(); return { bytes: serialize(dump), tables: dump.length };
  } catch (error) { await admin.rollback(); throw error; }
}
export async function restore(admin, bytes) {
  await admin.query('SET FOREIGN_KEY_CHECKS=0');
  try {
    for (const table of deserialize(bytes)) {
      await admin.query(table.ddl);
      for (const row of table.rows) {
        const keys = Object.keys(row), values = Object.values(row).map(value => value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) ? JSON.stringify(value) : value);
        await admin.execute(`INSERT INTO ${identifier(table.name)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, values);
      }
    }
  } finally { await admin.query('SET FOREIGN_KEY_CHECKS=1'); }
}
