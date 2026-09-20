// Dedicated disposable MySQL test; never selects a service from a repository .env.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {inspect,queries,fingerprint} from './backend_schema_readonly.mjs';

const require = createRequire(new URL('../../apps/api/package.json',import.meta.url));
const mysql = require('mysql2/promise');
const mariadb = require('mariadb');
let directory,server,admin,runtime,createdDatabase=false,createdUser=false;
const password=randomBytes(32).toString('hex');
const migrations=[{name:'20260101000000_fixture',checksum:'a'.repeat(64)}];
async function unusedPort() {
  const listener=createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening');
  const port=listener.address().port; await new Promise(resolve=>listener.close(resolve)); return port;
}
async function command(args) {
  const child=spawn('mysqld',args,{stdio:'ignore'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  try { const [code]=await once(child,'exit'); assert.equal(code,0); }
  finally {clearTimeout(timer);}
}
async function schema() {
  const result={}; for(const [key,sql] of Object.entries(queries)) result[key]=await runtime.query(sql);
  return result;
}
try {
  let port,rootPassword;
  if(process.env.TEST_MYSQL_PORT) {
    assert.equal(process.env.ROGICHAT_TEST_MYSQL,'disposable');
    assert.match(process.env.TEST_MYSQL_PORT,/^[0-9]+$/);
    assert.ok(process.env.TEST_MYSQL_ROOT_PASSWORD);
    port=Number(process.env.TEST_MYSQL_PORT); rootPassword=process.env.TEST_MYSQL_ROOT_PASSWORD;
    assert.ok(port>0 && port<=65535);
  } else {
    directory=await mkdtemp(join(tmpdir(),'rogichat-readonly-'));
    port=await unusedPort(); rootPassword='';
    await command(['--no-defaults','--initialize-insecure',`--datadir=${directory}`]);
    server=spawn('mysqld',['--no-defaults',`--datadir=${directory}`,`--socket=${join(directory,'mysql.sock')}`,
      `--pid-file=${join(directory,'mysql.pid')}`,'--bind-address=127.0.0.1',`--port=${port}`,
      '--mysqlx=OFF','--skip-log-bin','--performance-schema=OFF','--innodb-buffer-pool-size=64M'],{stdio:'ignore'});
    server.on('error',()=>{});
  }
  for(let attempt=0;attempt<100 && !admin;attempt++) {
    try {admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password:rootPassword,connectTimeout:1000});}
    catch {await new Promise(resolve=>setTimeout(resolve,200));}
  }
  assert.ok(admin,'disposable MySQL did not start');
  const [version]=await admin.query('SELECT VERSION() AS version'); assert.match(version[0].version,/^8\.0\./);
  // Fixed production-probe identity is used ONLY after proving fixture names absent.
  const [dbs]=await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='rogichatqa'");
  const [users]=await admin.query("SELECT User FROM mysql.user WHERE User='rogichat_app'");
  assert.equal(dbs.length,0); assert.equal(users.length,0);
  await admin.query('CREATE DATABASE rogichatqa'); createdDatabase=true;
  await admin.query("CREATE USER 'rogichat_app'@'%' IDENTIFIED BY ?",[password]); createdUser=true;
  await admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON rogichatqa.* TO 'rogichat_app'@'%'");
  await admin.query('USE rogichatqa');
  await admin.query('CREATE TABLE _prisma_migrations (id INT PRIMARY KEY, migration_name VARCHAR(100),checksum CHAR(64),finished_at DATETIME(3),rolled_back_at DATETIME(3))');
  await admin.query('INSERT INTO _prisma_migrations VALUES (1,?,?,CURRENT_TIMESTAMP(3),NULL)',[migrations[0].name,migrations[0].checksum]);
  await admin.query('CREATE TABLE parent (id INT PRIMARY KEY AUTO_INCREMENT, value INT NOT NULL, CONSTRAINT positive CHECK(value>0))');
  await admin.query('CREATE TABLE child (id INT PRIMARY KEY, parent_id INT, CONSTRAINT parent_fk FOREIGN KEY(parent_id) REFERENCES parent(id))');
  // Fixture's generated self-signed certificate only; actual probe main requires
  // the policy-pinned CA and rejectUnauthorized:true. No external host is accepted.
  runtime=await mariadb.createConnection({host:'127.0.0.1',port,user:'rogichat_app',password,database:'rogichatqa',
    ssl:{rejectUnauthorized:false},connectTimeout:2000,socketTimeout:5000,multipleStatements:false});
  const baseline=fingerprint(await schema()); const policy={migrations,schema_sha256:baseline};
  assert.equal((await inspect(runtime,policy)).schema,'exact');
  // Prove the actual MySQL transaction rejects DML, then exercise all real reads.
  const query=runtime.query.bind(runtime);
  const observed={query:async sql=>{
    const result=await query(sql);
    if(sql==='START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY') {
      await assert.rejects(query('INSERT INTO parent(value) VALUES(1)'),{code:'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION'});
    }
    return result;
  }};
  await inspect(observed,policy);
  await admin.query('INSERT INTO parent(value) VALUES(1)');
  assert.equal(fingerprint(await schema()),baseline,'row count/auto-increment must not change fingerprint');
  for(const [change,restore] of [
    ['ALTER TABLE parent ADD extra INT','ALTER TABLE parent DROP extra'],
    ['CREATE INDEX changed_index ON parent(value)','DROP INDEX changed_index ON parent'],
    ['ALTER TABLE child DROP FOREIGN KEY parent_fk','ALTER TABLE child ADD CONSTRAINT parent_fk FOREIGN KEY(parent_id) REFERENCES parent(id)'],
  ]) {
    await admin.query(change); await assert.rejects(inspect(runtime,policy));
    await admin.query(restore); await inspect(runtime,policy);
  }
  for(const [change,restore] of [
    ["UPDATE _prisma_migrations SET checksum=REPEAT('b',64)","UPDATE _prisma_migrations SET checksum=REPEAT('a',64)"],
    ['UPDATE _prisma_migrations SET finished_at=NULL','UPDATE _prisma_migrations SET finished_at=CURRENT_TIMESTAMP(3)'],
    ['UPDATE _prisma_migrations SET rolled_back_at=CURRENT_TIMESTAMP(3)','UPDATE _prisma_migrations SET rolled_back_at=NULL'],
    ['INSERT INTO _prisma_migrations SELECT 2,migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations WHERE id=1','DELETE FROM _prisma_migrations WHERE id=2'],
  ]) {
    await admin.query(change); await assert.rejects(inspect(runtime,policy)); await admin.query(restore);
  }
  await admin.query("GRANT CREATE ON rogichatqa.* TO 'rogichat_app'@'%'");
  await assert.rejects(inspect(runtime,policy));
  await admin.query("REVOKE CREATE ON rogichatqa.* FROM 'rogichat_app'@'%'");
  await inspect(runtime,policy);
  await admin.query('DROP TABLE _prisma_migrations'); await assert.rejects(inspect(runtime,policy));
  console.log('Disposable MySQL: readonly transaction, exact ledger, DML-only grants and physical fingerprint passed.');
} catch(error) {
  console.error('Disposable schema probe test failed:',error.code ?? error.name);
  process.exitCode=1;
} finally {
  await runtime?.end();
  if(admin) {
    if(createdDatabase) await admin.query('DROP DATABASE rogichatqa');
    if(createdUser) await admin.query("DROP USER 'rogichat_app'@'%'");
    await admin.end();
  }
  if(server && server.exitCode===null && server.signalCode===null) {
    const exit=once(server,'exit'); server.kill('SIGTERM');
    const timer=setTimeout(()=>server.kill('SIGKILL'),10000);
    try {await exit;} finally {clearTimeout(timer);}
  }
  if(directory) await rm(directory,{recursive:true,force:true});
}
