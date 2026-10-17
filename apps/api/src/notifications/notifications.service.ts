import { Controller, Get, Global, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { DB, Database } from '../database/database.module';
import { notifications, NotificationRow, users } from '../database/schema';

export interface NotificationInput {
  kind: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  data?: Record<string, unknown>;
  /** When set, a second notification with the same key for the same user is skipped. */
  dedupeKey?: string;
}

/**
 * In-app notifications, stored per user. Push delivery (FCM) is added in phase 5 and will read
 * from here, so every notification already exists in the user's inbox.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Returns how many were actually created (duplicates are skipped). */
  async notify(userIds: string[], input: NotificationInput): Promise<number> {
    if (userIds.length === 0) return 0;
    const rows = await this.db
      .insert(notifications)
      .values(
        userIds.map((userId) => ({
          userId,
          kind: input.kind,
          titleAr: input.titleAr,
          titleEn: input.titleEn,
          bodyAr: input.bodyAr,
          bodyEn: input.bodyEn,
          data: input.data ?? null,
          dedupeKey: input.dedupeKey ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** Active admins of a partner: the people who act on driver applications and expiries. */
  async partnerAdminIds(partnerId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.partnerId, partnerId),
          inArray(users.role, ['partner_admin', 'dispatcher']),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
        ),
      );
    return rows.map((r) => r.id);
  }

  list(userId: string, limit: number): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}

class ListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

class NotificationView {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: Object }) data!: unknown;
  @ApiProperty() read!: boolean;
  @ApiProperty() createdAt!: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('v1/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user’s notifications, newest first, in their language' })
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery): Promise<NotificationView[]> {
    const me = await this.db.query.users.findFirst({ columns: { locale: true }, where: eq(users.id, user.id) });
    const en = me?.locale === 'en';
    const rows = await this.notifications.list(user.id, q.limit);
    return rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: en ? n.titleEn : n.titleAr,
      body: en ? n.bodyEn : n.bodyAr,
      data: n.data,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
