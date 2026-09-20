import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,fingerprint,validateHistory,validateGrants,inspect,queries,historySQL} from './backend_schema_readonly.mjs';
const migrations = [{name: '20260101000000_fixture', checksum: 'a'.repeat(64)}];
const row = {migration_name: migrations[0].name, checksum: migrations[0].checksum, finished_at: new Date(), rolled_back_at: null};
const grants = [{'Grants': 'GRANT SELECT, INSERT, UPDATE, DELETE ON `rogichatqa`.* TO `rogichat_app`@`%`'}];
const schema = {tables: [{TABLE_NAME:'fixture'}], columns:[{COLUMN_NAME:'id', COLUMN_TYPE:'int'}], indexes:[], foreignKeys:[], checks:[]};
test('exact ledger rejects absent/extra/duplicate/failed/rolled back/checksum drift', () => {
  validateHistory([row], migrations);
  for (const rows of [[], [row,row], [{...row,finished_at:null}], [{...row,rolled_back_at:new Date()}], [{...row,checksum:'b'.repeat(64)}]]) {
    assert.throws(() => validateHistory(rows,migrations));
  }
});
test('grants reject DDL, roles, grant option and global access', () => {
  validateGrants(grants);
  for (const text of ['CREATE, ', 'ALTER, ', 'DROP, ']) assert.throws(() => validateGrants([{g:grants[0].Grants.replace('SELECT, ',text)}]));
  assert.throws(() => validateGrants([{g:grants[0].Grants + ' WITH GRANT OPTION'}]));
  assert.throws(() => validateGrants([...grants,{g:'GRANT `admin`@`%` TO `rogichat_app`@`%`'}]));
  assert.throws(() => validateGrants([{g:grants[0].Grants.replace('`rogichatqa`.*','*.*')}]));
});
test('physical fingerprint is canonical and catches drift', () => {
  assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
  const changed = structuredClone(schema); changed.columns[0].COLUMN_TYPE='bigint';
  assert.notEqual(fingerprint(schema),fingerprint(changed));
  assert.ok(Object.values(queries).every(sql=>sql.startsWith('SELECT ')));
  assert.ok(Object.values(queries).every(sql=>!sql.includes('AUTO_INCREMENT')));
});
test('read-only transaction always rolls back, including physical mismatch', async () => {
  for (const schema_sha256 of [fingerprint(schema), 'f'.repeat(64)]) {
    const calls = [];
    const connection = {query: async sql => {
      calls.push(sql);
      if(sql.startsWith('SELECT DATABASE')) return [{db:'rogichatqa',account:'rogichat_app@%'}];
      if(sql.startsWith('SHOW SESSION')) return [{Value:'TLS'}];
      if(sql.startsWith('SHOW GRANTS')) return grants;
      if(sql===historySQL) return [row];
      const key=Object.keys(queries).find(k=>queries[k]===sql);
      return key ? schema[key] : [];
    }};
    const result=inspect(connection,{migrations,schema_sha256});
    if(schema_sha256===fingerprint(schema)) await result; else await assert.rejects(result);
    assert.equal(calls.at(-1),'ROLLBACK');
    assert.ok(calls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
  }
});
