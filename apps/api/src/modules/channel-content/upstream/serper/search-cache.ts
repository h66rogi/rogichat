import { Injectable } from '@nestjs/common';

/** Local equivalent of Meloming's cache-manager contract for search responses. */
@Injectable()
export class SearchCache {
  private readonly entries=new Map<string,{value:unknown;expiresAt:number}>();
  async get<T>(key:string):Promise<T|undefined> {
    const entry=this.entries.get(key);
    if(!entry)return undefined;
    if(entry.expiresAt<=Date.now()){this.entries.delete(key);return undefined;}
    return entry.value as T;
  }
  async set<T>(key:string,value:T,ttlMs:number):Promise<void> {
    if(this.entries.size>=1000){const oldest=this.entries.keys().next().value;if(oldest)this.entries.delete(oldest);}
    this.entries.set(key,{value,expiresAt:Date.now()+ttlMs});
  }
}

@Injectable()
export class SearchEnvironment {
  get<T extends string|number>(key:string):T|undefined {return process.env[key] as T|undefined;}
}
