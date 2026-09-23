// Ported from meloming-back a91393b2 src/schedule/recurring/recurring-schedule.service.ts.
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { ChannelRecurringSchedule, Prisma } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { SafeLogger } from '../../infrastructure/observability/logging.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
type Template = {dayOfWeek:number;title:string;startTime:string|null;status:'LIVE'|'OFF';isActive:boolean};
function parse(value:unknown):Template[] {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  const body=value as Record<string,unknown>;
  if (Object.keys(body).some(key=>key!=='schedules') || !Array.isArray(body.schedules) || body.schedules.length>7) throw new ApiError('INVALID_REQUEST',400);
  const seen=new Set<number>();
  return body.schedules.map((raw):Template=>{
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new ApiError('INVALID_REQUEST',400);
    const item=raw as Record<string,unknown>;
    if (Object.keys(item).some(key=>!['dayOfWeek','title','startTime','status','isActive'].includes(key)) ||
      !Number.isSafeInteger(item.dayOfWeek) || Number(item.dayOfWeek)<0 || Number(item.dayOfWeek)>6 ||
      typeof item.title!=='string' || !item.title.trim() || item.title.length>100 ||
      !['LIVE','OFF'].includes(String(item.status)) || typeof item.isActive!=='boolean' ||
      (item.status==='LIVE' && (typeof item.startTime!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime))) ||
      (item.startTime!=null && (typeof item.startTime!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime)))) throw new ApiError('INVALID_REQUEST',400);
    const dayOfWeek=Number(item.dayOfWeek);
    if (seen.has(dayOfWeek)) throw new ApiError('INVALID_REQUEST',400);
    seen.add(dayOfWeek);
    return {dayOfWeek,title:item.title.trim(),startTime:item.status==='OFF'?null:item.startTime as string,status:item.status as 'LIVE'|'OFF',isActive:item.isActive};
  });
}
function kstDayOffset(days:number,hour=0,minute=0):Date {
  const today=new Date(Date.now()+KST_OFFSET_MS);
  return new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()+days,hour,minute)-KST_OFFSET_MS);
}
function generationRange() {
  const from=kstDayOffset(1);
  const fourWeeks=kstDayOffset(28);
  const sunday=new Date(fourWeeks.getTime()+KST_OFFSET_MS);
  const daysUntilSunday=(7-sunday.getUTCDay())%7;
  const to=kstDayOffset(28+daysUntilSunday,23,59);
  return {from,to};
}
function response(row:ChannelRecurringSchedule) {
  return {id:row.id,channelId:'hurogi',dayOfWeek:row.dayOfWeek,title:row.title,startTime:row.startTime,
    status:row.status,isActive:row.isActive,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}

@Injectable()
export class RecurringScheduleService {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(ChannelContentRepository) private readonly repository:ChannelContentRepository) {}

  list() {return this.transactions.read(async tx=>{
    const {roomId}=await this.repository.primary(tx);
    const rows=await tx.prisma.channelRecurringSchedule.findMany({where:{channelId:roomId},orderBy:{dayOfWeek:'asc'}});
    return {items:rows.map(response)};
  });}

  save(credentials:CommandCredentials,value:unknown) {
    const schedules=parse(value);
    return this.transactions.write(async tx=>{
      const actor=await this.auth.require(tx,credentials,true);
      const roomId=await this.repository.requireOwner(tx,actor.userId);
      await tx.rows('SELECT `key` FROM default_room_bindings WHERE `key`=? FOR UPDATE',['primary']);
      const existing=await tx.prisma.channelRecurringSchedule.findMany({where:{channelId:roomId},select:{id:true,dayOfWeek:true}});
      const days=new Set(schedules.map(row=>row.dayOfWeek));
      const {from,to}=generationRange();
      if (existing.length) await tx.prisma.channelSchedule.updateMany({where:{channelId:roomId,recurringScheduleId:{in:existing.map(row=>row.id)},startAt:{gte:from},isDeleted:false},data:{isDeleted:true,deletedAt:new Date()}});
      const removed=existing.filter(row=>!days.has(row.dayOfWeek)).map(row=>row.id);
      if (removed.length) await tx.prisma.channelRecurringSchedule.deleteMany({where:{id:{in:removed}}});
      const rows:ChannelRecurringSchedule[]=[];
      for (const item of schedules) rows.push(await tx.prisma.channelRecurringSchedule.upsert({where:{channelId_dayOfWeek:{channelId:roomId,dayOfWeek:item.dayOfWeek}},
        create:{id:await nextChannelContentId(tx.prisma),channelId:roomId,...item},update:{title:item.title,startTime:item.startTime,status:item.status,isActive:item.isActive}}));
      await this.generate(tx,roomId,actor.userId,rows.filter(row=>row.isActive),from,to);
      return {items:rows.sort((a,b)=>a.dayOfWeek-b.dayOfWeek).map(response)};
    });
  }

  async refreshUpcoming() {
    await this.transactions.write(async tx=>{
      await tx.rows('SELECT `key` FROM default_room_bindings WHERE `key`=? FOR UPDATE',['primary']);
      const {roomId,ownerId}=await this.repository.primary(tx);
      if (!ownerId) return;
      const templates=await tx.prisma.channelRecurringSchedule.findMany({where:{channelId:roomId,isActive:true}});
      if (!templates.length) return;
      const {from,to}=generationRange();
      await this.generate(tx,roomId,ownerId,templates,from,to);
    });
  }

  private async generate(tx:Transaction,channelId:string,authorUserId:string,templates:ChannelRecurringSchedule[],from:Date,to:Date) {
    const byDay=new Map(templates.map(row=>[row.dayOfWeek,row]));
    const existing=await tx.prisma.channelSchedule.findMany({where:{channelId,isDeleted:false,startAt:{gte:from,lte:to}},select:{startAt:true}});
    const starts=new Set(existing.map(row=>row.startAt.getTime()));
    const created:Prisma.ChannelScheduleCreateManyInput[]=[];
    for (let current=from.getTime();current<=to.getTime();current+=86400000) {
      const kst=new Date(current+KST_OFFSET_MS);
      const template=byDay.get(kst.getUTCDay());
      if (!template) continue;
      const [hour,minute]=template.startTime?.split(':').map(Number)??[0,0];
      const allDay=template.status==='OFF'||!template.startTime;
      const startAt=new Date(Date.UTC(kst.getUTCFullYear(),kst.getUTCMonth(),kst.getUTCDate(),hour,minute)-KST_OFFSET_MS);
      if (starts.has(startAt.getTime())) continue;
      starts.add(startAt.getTime());
      created.push({id:await nextChannelContentId(tx.prisma),channelId,authorUserId,recurringScheduleId:template.id,title:template.title,startAt,allDay,
        status:template.status==='OFF'?'OFF':'LIVE',visibility:'PUBLIC'});
    }
    if (created.length) await tx.prisma.channelSchedule.createMany({data:created});
  }
}

/** Rogichat has a continuously running API, rather than Meloming's cron module. */
@Injectable()
export class RecurringScheduleRefresh implements OnApplicationBootstrap,OnModuleDestroy {
  private timer:ReturnType<typeof setTimeout>|null=null;
  private stopped=false;
  private readonly logger=new SafeLogger('api');
  constructor(@Inject(RecurringScheduleService) private readonly recurring:RecurringScheduleService) {}
  onApplicationBootstrap(){this.schedule(0);}
  onModuleDestroy(){this.stopped=true;if(this.timer) clearTimeout(this.timer);}
  private schedule(delay:number){
    this.timer=setTimeout(()=>{void this.recurring.refreshUpcoming().catch(()=>{
      this.logger.event('channel_schedule_refresh_failed',{reason:'runtime'});
    }).finally(()=>{
      if(!this.stopped)this.schedule(60*60*1000);
    });},delay);
    this.timer.unref();
  }
}
