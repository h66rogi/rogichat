import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class MergeRequestDto {
  @IsInt()
  @IsPositive()
  winnerId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  @Type(() => Number)
  loserIds!: number[];

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export interface MergeResponseDto {
  winnerId: number;
  loserIds: number[];
  dryRun: boolean;
  aliasesMoved: number;
  aliasesDropped: number;
  songsReassigned: number;
  conflictSongsAutoMerged: number;
  chainsFlattened: number;
  winnerChannelCountBefore: number;
  winnerChannelCountAfter: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}
