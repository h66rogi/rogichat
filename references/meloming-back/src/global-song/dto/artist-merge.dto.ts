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

export class ArtistMergeRequestDto {
  @IsInt()
  @IsPositive()
  winnerId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
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

export interface ArtistMergeResponseDto {
  winnerId: number;
  loserIds: number[];
  dryRun: boolean;
  songsReassigned: number;
  conflictSongsAutoMerged: number;
  aliasesMoved: number;
  aliasesDropped: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}
