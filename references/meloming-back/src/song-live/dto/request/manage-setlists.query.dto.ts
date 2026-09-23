import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 채널 owner / canManageContent 매니저용 셋리스트 관리 목록 query DTO.
 *
 * 공개 query 와 달리 visibility 필터를 적용하지 않으므로 PUBLIC + PRIVATE 모두 반환.
 * from/to range 는 관리 페이지에서 굳이 필요하지 않아 단순화 (page/limit 만).
 */
export class ManageSetlistsQueryDto {
  @IsString()
  identifier: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
