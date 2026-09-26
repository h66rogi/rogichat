import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';

export async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL,'disposable');
  const url=new URL(process.env.TEST_ADMIN_URL);
  const original=url.pathname.slice(1),schema=`channel_${randomBytes(8).toString('hex')}`;
  assert.match(original,/^rogichat_test_[a-f0-9]+$/);
  const admin=await createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:original,multipleStatements:true});
  const runtimeUser=`channel_${randomBytes(8).toString('hex')}`,runtimePassword=randomBytes(24).toString('hex');
  let db;
  t.after(async()=>{await db?.close();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query("DROP USER IF EXISTS ?@'%'",[runtimeUser]);await admin.end();});
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query(`USE \`${schema}\``);
  for(const migration of migrationManifest) await admin.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`,import.meta.url),'utf8'));
  await admin.query(`CREATE TABLE _prisma_migrations LIKE \`${original}\`._prisma_migrations`);
  await admin.query(`INSERT INTO _prisma_migrations SELECT * FROM \`${original}\`._prisma_migrations`);
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?",[runtimeUser,runtimePassword]);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${schema}\`.* TO ?@'%'`,[runtimeUser]);
  url.pathname=`/${schema}`;url.username=runtimeUser;url.password=runtimePassword;
  db=new PrismaDatabase(readConfig('worker',{...process.env,DATABASE_URL:url.href,DB_POOL_SIZE:'2'}));
  const roomId=randomUUID(),ownerId=randomUUID(),fanId=randomUUID(),memberId=randomUUID();
  await db.transactions.write(async tx=>{
    await tx.prisma.users.create({data:{id:ownerId,profile:{create:{nickname:'소유자'}}}});
    await tx.prisma.users.create({data:{id:fanId,profile:{create:{nickname:'팬'}}}});
    await tx.prisma.rooms.create({data:{id:roomId,name:'후로기',mode:'FAN'}});
    await tx.prisma.room_members.create({data:{id:memberId,room_id:roomId,user_id:ownerId,role:'STREAMER'}});
    await tx.prisma.rooms.update({where:{id:roomId},data:{owner_member_id:memberId}});
    await tx.prisma.default_room_bindings.create({data:{key:'primary',room_id:roomId,owner_bound:true}});
    await tx.prisma.creator_accounts.create({data:{user_id:ownerId,enabled:true}});
  });
  return {db,roomId,ownerId,fanId};
}
