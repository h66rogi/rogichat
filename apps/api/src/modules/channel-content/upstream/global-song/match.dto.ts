/** Response shape copied from Meloming's global-song matcher DTO. */
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type MatchMethod = 'EXACT' | 'ALIAS' | 'FUZZY' | 'AI';
export interface MatchRequestDto { query:string; channelId?:number; limit?:number }
export interface MatchResultItem {
  globalSongId:number; title:string; artist:string; albumArt:string|null;
  channelCount:number; matchConfidence:MatchConfidence; matchMethod:MatchMethod;
  alreadyInChannel?:boolean|undefined; topCategories:string[];
}
export interface MatchResponseDto {
  results:MatchResultItem[]; query:{parsedTitle:string;parsedArtist:string|null};
}
