import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** ?page=&pageSize= for admin lists. Extend it with the list's own filters. */
export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageOf<T>(items: T[], total: number, q: { page?: number; pageSize?: number }): Page<T> {
  return { items, total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
}

export function offsetOf(q: { page?: number; pageSize?: number }): number {
  return ((q.page ?? 1) - 1) * (q.pageSize ?? 50);
}
