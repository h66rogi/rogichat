import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateCredential,validateGrants,validateHistory} from './production_readiness.mjs';
const v={host:'rogichat-prod.cluster-fixture.ap-northeast-2.rds.amazonaws.com',port:3306,
  database:'rogichatprod',username:'rogichat_app',password:'synthetic-fixture-'.repeat(3)};
const hash=crypto.createHash('sha256').update(v.host).digest('hex');
test('production account/host/database are all bound',()=>{
  assert.equal(validateCredential(v,hash),v);
  for(const [key,value] of [['host',v.host.replace('prod','qa')],['database','rogichatqa'],['username','rogichat_migrator'],['port',3307]])
    assert.throws(()=>validateCredential({...v,[key]:value},hash));
  assert.throws(()=>validateCredential(v,'0'.repeat(64)));
});
test('DDL, global, QA, grant option and partial runtime grants refused',()=>{
  const row=grant=>[{'Grants':grant}];
  validateGrants(row('GRANT SELECT, INSERT, UPDATE, DELETE ON `rogichatprod`.* TO `rogichat_app`@`%`'));
  for(const grant of ['GRANT ALL PRIVILEGES ON *.* TO user','GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON `rogichatprod`.* TO user',
    'GRANT SELECT ON `rogichatprod`.* TO user','GRANT SELECT, INSERT, UPDATE, DELETE ON `rogichatqa`.* TO user',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON `rogichatprod`.* TO user WITH GRANT OPTION']) assert.throws(()=>validateGrants(row(grant)));
});
test('schema must be exact and fully completed; no empty bootstrap acceptance',()=>{
  const manifest=[{name:'20260920000000_test',checksum:'a'.repeat(64)}];
  const rows=[{migration_name:manifest[0].name,checksum:manifest[0].checksum,finished_at:'done',rolled_back_at:null}];
  validateHistory(rows,manifest);
  for(const bad of [[],[...rows,...rows],[{...rows[0],checksum:'b'.repeat(64)}],[{...rows[0],finished_at:null}],[{...rows[0],rolled_back_at:'rolled'}]])
    assert.throws(()=>validateHistory(bad,manifest));
  assert.throws(()=>validateHistory([],[]));
});
