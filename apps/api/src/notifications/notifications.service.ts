import { Body, Controller, Delete, Get, Global, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { DB, Database } from '../database/database.module';
import { deviceTokens, notifications, NotificationRow, users } from '../database/schema';
import { PushService } from './push.service';

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
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly push: PushService,
  ) {}

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
      .returning({ id: notifications.id, userId: notifications.userId });
    // Push to phones in the background; the inbox already has it if push is off or fails.
    if (rows.length > 0) void this.push.toUsers([...new Set(rows.map((r) => r.userId))], input);
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

  /** Keeps one row per device token; a token moving to another account follows the new account. */
  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    await this.db
      .insert(deviceTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: deviceTokens.token, set: { userId, platform, updatedAt: new Date() } });
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
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

class DeviceDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging registration token' })
  @IsString()
  @Length(20, 400)
  token!: string;

  @ApiProperty({ enum: ['android', 'ios', 'web'] })
  @IsIn(['android', 'ios', 'web'])
  platform!: string;
}

class DeviceRemoveDto {
  @ApiProperty() @IsString() @Length(20, 400) token!: string;
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

  @Post('devices')
  @HttpCode(204)
  @ApiOperation({ summary: 'Register this phone for push notifications (call after every sign-in and token refresh)' })
  async device(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto): Promise<void> {
    await this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  @Delete('devices')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop push notifications to this phone (call on sign-out)' })
  async removeDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceRemoveDto): Promise<void> {
    await this.notifications.removeDevice(user.id, dto.token);
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
  providers: [NotificationsService, PushService],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
