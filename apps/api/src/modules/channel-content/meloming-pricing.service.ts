import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { SongPricingService } from './upstream/song-pricing/song-pricing.service.js';
import type { CurrencyPriceMap, DifficultyPrices, DifficultyPricesByCurrency,
  CurrencyConfig } from './upstream/song-pricing/types/pricing.types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  return value as Record<string,unknown>;
}
function amount(value:unknown):boolean {
  return value===null || (typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000);
}
function priceMap(value:unknown):value is CurrencyPriceMap|null {
  if(value===null)return true;
  const raw=record(value);
  return Object.keys(raw).length<=10&&Object.entries(raw).every(([key,price])=>
    /^[A-Z0-9_]{1,50}$/.test(key)&&amount(price));
}
function difficulty(value:unknown):value is DifficultyPrices|null {
  if(value===null)return true;
  const raw=record(value);
  return Object.keys(raw).length<=5&&Object.entries(raw).every(([key,price])=>
    /^[1-5]$/.test(key)&&amount(price));
}
function pricingInput(value:unknown) {
  const raw=record(value);
  const fields=['pricingEnabled','defaultPrice','defaultPrices','difficultyPrices',
    'difficultyPricesByCurrency','currencyConfigs'];
  if(Object.keys(raw).some(key=>!fields.includes(key)) ||
    raw.pricingEnabled!==undefined&&typeof raw.pricingEnabled!=='boolean' ||
    raw.defaultPrice!==undefined&&!amount(raw.defaultPrice) ||
    raw.defaultPrices!==undefined&&!priceMap(raw.defaultPrices) ||
    raw.difficultyPrices!==undefined&&!difficulty(raw.difficultyPrices))throw new ApiError('INVALID_REQUEST',400);
  if(raw.difficultyPricesByCurrency!==undefined&&raw.difficultyPricesByCurrency!==null) {
    const byCurrency=record(raw.difficultyPricesByCurrency);
    if(Object.keys(byCurrency).length>10||Object.entries(byCurrency).some(([key,prices])=>
      !/^[A-Z0-9_]{1,50}$/.test(key)||!difficulty(prices)))throw new ApiError('INVALID_REQUEST',400);
  }
  if(raw.currencyConfigs!==undefined&&raw.currencyConfigs!==null) {
    if(!Array.isArray(raw.currencyConfigs)||raw.currencyConfigs.length>10||raw.currencyConfigs.some(item=>{
      const entry=record(item);
      return Object.keys(entry).some(key=>!['key','unit','amount'].includes(key))||
        typeof entry.key!=='string'||!/^[A-Z0-9_]{1,50}$/.test(entry.key)||
        typeof entry.unit!=='string'||!entry.unit.trim()||entry.unit.length>20||
        entry.amount!==undefined&&!amount(entry.amount);
    }))throw new ApiError('INVALID_REQUEST',400);
  }
  return raw as Partial<{pricingEnabled:boolean;defaultPrice:number|null;
    defaultPrices:CurrencyPriceMap|null;difficultyPrices:DifficultyPrices|null;
    difficultyPricesByCurrency:DifficultyPricesByCurrency|null;currencyConfigs:CurrencyConfig[]|null}>;
}
function itemPriceInput(value:unknown) {
  const raw=record(value);
  if(!Object.keys(raw).length||Object.keys(raw).some(key=>!['price','currencyPrices'].includes(key))||
    raw.price!==undefined&&!amount(raw.price)||
    raw.currencyPrices!==undefined&&!priceMap(raw.currencyPrices))throw new ApiError('INVALID_REQUEST',400);
  return raw as {price?:number|null;currencyPrices?:CurrencyPriceMap|null};
}

@Injectable()
export class MelomingPricingService {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(AuthService) private readonly auth:AuthService,
    @Inject(ChannelContentRepository) private readonly repository:ChannelContentRepository) {}

  private response(pricing:SongPricingService,settings:Awaited<ReturnType<SongPricingService['getPricingSettings']>>) {
    const data=pricing.extractPricingData(settings);
    const currencyKey=pricing.resolveCurrencyKey('SOOP',data.currencyConfigs,[data.defaultPrices]);
    return {channelId:1,pricingEnabled:settings?.pricingEnabled??false,
      defaultPrice:settings?.defaultPrice??(currencyKey?data.defaultPrices?.[currencyKey]??null:null),
      defaultPrices:data.defaultPrices,difficultyPrices:currencyKey&&data.difficultyPricesByCurrency?.[currencyKey]
        ?data.difficultyPricesByCurrency[currencyKey]:data.difficultyPrices,
      difficultyPricesByCurrency:data.difficultyPricesByCurrency,
      currencyUnit:pricing.resolveCurrencyUnit('SOOP',data.currencyConfigs,currencyKey),
      currencyConfigs:data.currencyConfigs};
  }

  get() {return this.transactions.read(async tx=>{
    const {roomId}=await this.repository.primary(tx);
    const pricing=new SongPricingService(tx.prisma);
    return this.response(pricing,await pricing.getPricingSettings(roomId));
  });}

  update(credentials:CommandCredentials,value:unknown) {
    const dto=pricingInput(value);
    return this.transactions.write(async tx=>{
      const actor=await this.auth.require(tx,credentials,true);
      const roomId=await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const pricing=new SongPricingService(tx.prisma);
      return this.response(pricing,await pricing.updatePricingSettings(roomId,dto));
    });
  }

  private async item(tx:Parameters<Parameters<Transactions['read']>[0]>[0],roomId:string,id:number,kind:'song'|'category') {
    const row=kind==='song'?await tx.prisma.song.findFirst({where:{id,channelId:roomId},select:{id:true}}):
      await tx.prisma.category.findFirst({where:{id,channelId:roomId},select:{id:true}});
    if(!row)throw new ApiError('NOT_FOUND',404);
  }

  updateItem(credentials:CommandCredentials,id:number,kind:'song'|'category',value:unknown) {
    const dto=itemPriceInput(value);
    return this.transactions.write(async tx=>{
      const actor=await this.auth.require(tx,credentials,true);
      const roomId=await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      await this.item(tx,roomId,id,kind);
      const pricing=new SongPricingService(tx.prisma);
      return kind==='song'?pricing.updateSongPrice(id,dto.price,dto.currencyPrices):
        pricing.updateCategoryPrice(id,dto.price,dto.currencyPrices);
    });
  }

  songPrice(id:number) {return this.transactions.read(async tx=>{
    const {roomId}=await this.repository.primary(tx);
    await this.item(tx,roomId,id,'song');
    const result=await new SongPricingService(tx.prisma).calculatePrice(id,roomId);
    return {songId:id,...result};
  });}

  calculate(value:unknown) {
    const raw=record(value);
    if(Object.keys(raw).length!==1||!Array.isArray(raw.songIds)||!raw.songIds.length||raw.songIds.length>100||
      raw.songIds.some(id=>!Number.isSafeInteger(id)||id<1))throw new ApiError('INVALID_REQUEST',400);
    const ids=raw.songIds as number[];
    return this.transactions.read(async tx=>{
      const {roomId}=await this.repository.primary(tx);
      const count=await tx.prisma.song.count({where:{id:{in:[...new Set(ids)]},channelId:roomId}});
      if(count!==new Set(ids).size)throw new ApiError('NOT_FOUND',404);
      const prices=await new SongPricingService(tx.prisma).calculatePricesForSongs(ids,roomId);
      return ids.map(songId=>({songId,...prices.get(songId)!}));
    });
  }
}
