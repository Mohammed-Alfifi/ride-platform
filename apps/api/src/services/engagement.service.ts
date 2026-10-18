import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, avg, count, desc, eq, gte, isNull, lte, sql, SQL } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.types';
import { AppError } from '../common/errors';
import { assertPartnerAccess, partnerScope } from '../common/tenant';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import {
  driverProfiles,
  supportTickets,
  ticketMessages,
  tripRatings,
  trips,
  tripShares,
  users,
  vehicles,
} from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { distanceMeters, etaMinutes } from '../trips/geo';
import { LiveStore } from '../trips/live.store';

/** A shared link works until this long after the trip's time (or its end). */
const SHARE_HOURS = 3;
const ACTIVE = ['en_route', 'arrived', 'on_board'];
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const RATING_TAGS = ['on_time', 'safe_driving', 'clean_car', 'polite', 'late', 'unsafe_driving', 'unclean_car', 'rude'] as const;

/** Trip sharing, ratings and support: what riders and drivers do around a trip. */
@Injectable()
export class EngagementService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly live: LiveStore,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ sharing

  async share(riderId: string, tripId: string): Promise<{ url: string; expiresAt: string }> {
    const trip = await this.db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.riderId, riderId)) });
    if (!trip) throw new AppError('TRIP_NOT_FOUND');
    if (!['scheduled', ...ACTIVE].includes(trip.status)) throw new AppError('TRIP_INVALID_STATE');
    const token = randomBytes(24).toString('base64url');
    const from = Math.max(Date.now(), trip.scheduledAt.getTime());
    const expiresAt = new Date(from + SHARE_HOURS * 3600_000);
    await this.db.insert(tripShares).values({ tripId, createdBy: riderId, tokenHash: hash(token), expiresAt });
    return { url: `${this.env.PUBLIC_WEB_URL}/t/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async stopSharing(riderId: string, tripId: string): Promise<void> {
    await this.db
      .update(tripShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(tripShares.tripId, tripId), eq(tripShares.createdBy, riderId), isNull(tripShares.revokedAt)));
  }

  /** What a family member sees without the app: no phone numbers, first names only. */
  async shared(token: string) {
    const share = await this.db.query.tripShares.findFirst({ where: eq(tripShares.tokenHash, hash(token)) });
    if (!share || share.revokedAt || share.expiresAt.getTime() < Date.now()) throw new AppError('SHARE_NOT_FOUND');
    const [row] = await this.db
      .select({
        trip: trips,
        pickupLat: sql<number>`ST_Y(${trips.pickup})`,
        pickupLng: sql<number>`ST_X(${trips.pickup})`,
        dropoffLat: sql<number>`ST_Y(${trips.dropoff})`,
        dropoffLng: sql<number>`ST_X(${trips.dropoff})`,
        riderName: users.name,
        driverName: driverProfiles.fullName,
        make: vehicles.make,
        model: vehicles.model,
        color: vehicles.color,
        plateLetters: vehicles.plateLetters,
        plateNumbers: vehicles.plateNumbers,
      })
      .from(trips)
      .innerJoin(users, eq(users.id, trips.riderId))
      .leftJoin(driverProfiles, eq(driverProfiles.userId, trips.driverId))
      .leftJoin(vehicles, eq(vehicles.driverId, trips.driverId))
      .where(eq(trips.id, share.tripId));
    if (!row) throw new AppError('SHARE_NOT_FOUND');
    const t = row.trip;
    const first = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : null);
    const pickup = { lat: Number(row.pickupLat), lng: Number(row.pickupLng), name: t.pickupName };
    const dropoff = { lat: Number(row.dropoffLat), lng: Number(row.dropoffLng), name: t.dropoffName };
    const active = ACTIVE.includes(t.status);
    const loc = active && t.driverId ? await this.live.get(t.driverId) : null;
    const target = t.status === 'on_board' ? dropoff : pickup;
    const meters = loc ? distanceMeters(loc, target) : null;
    return {
      passenger: first(t.passengerName ?? row.riderName),
      status: t.status,
      leg: t.leg,
      scheduledAt: t.scheduledAt.toISOString(),
      pickup,
      dropoff,
      driver: t.driverId
        ? {
            name: first(row.driverName),
            vehicle: row.make ? `${row.make} ${row.model} · ${row.color}` : null,
            plate: row.plateNumbers ? `${row.plateNumbers} ${row.plateLetters}` : null,
          }
        : null,
      driverLocation: loc ? { lat: loc.lat, lng: loc.lng, heading: loc.heading } : null,
      etaMinutes: meters === null ? null : t.status === 'arrived' ? 0 : etaMinutes(meters),
      times: {
        startedAt: t.startedAt?.toISOString() ?? null,
        arrivedAt: t.arrivedAt?.toISOString() ?? null,
        pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
      },
      expiresAt: share.expiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ ratings

  async rate(riderId: string, tripId: string, dto: { stars: number; tags?: string[]; comment?: string }) {
    const trip = await this.db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.riderId, riderId)) });
    if (!trip) throw new AppError('TRIP_NOT_FOUND');
    if (trip.status !== 'completed') throw new AppError('RATING_NOT_ALLOWED');
    const values = {
      tripId,
      riderId,
      driverId: trip.driverId,
      partnerId: trip.partnerId,
      stars: dto.stars,
      tags: [...new Set(dto.tags ?? [])],
      comment: dto.comment?.trim() || null,
    };
    await this.db
      .insert(tripRatings)
      .values(values)
      .onConflictDoUpdate({ target: tripRatings.tripId, set: { stars: values.stars, tags: values.tags, comment: values.comment } });
    if (dto.stars <= 2) {
      const admins = await this.notifications.partnerAdminIds(trip.partnerId);
      await this.notifications.notify(admins, {
        kind: 'low_rating',
        titleAr: `تقييم منخفض (${dto.stars} من 5)`,
        titleEn: `Low rating (${dto.stars} of 5)`,
        bodyAr: values.comment ?? 'راجع الرحلة وتواصل مع الراكب.',
        bodyEn: values.comment ?? 'Review the trip and contact the rider.',
        data: { tripId },
        dedupeKey: `low_rating:${tripId}`,
      });
    }
    return { tripId, stars: values.stars, tags: values.tags, comment: values.comment };
  }

  async ratings(actor: AuthUser, q: { partnerId?: string; driverId?: string; from?: string; to?: string }) {
    const scope = partnerScope(actor, q.partnerId);
    const where: SQL[] = [];
    if (scope) where.push(eq(tripRatings.partnerId, scope));
    if (q.driverId) where.push(eq(tripRatings.driverId, q.driverId));
    if (q.from) where.push(gte(tripRatings.createdAt, new Date(`${q.from}T00:00:00+03:00`)));
    if (q.to) where.push(lte(tripRatings.createdAt, new Date(`${q.to}T23:59:59+03:00`)));
    const cond = where.length ? and(...where) : undefined;
    const [items, byDriver] = await Promise.all([
      this.db
        .select({
          tripId: tripRatings.tripId,
          stars: tripRatings.stars,
          tags: tripRatings.tags,
          comment: tripRatings.comment,
          createdAt: tripRatings.createdAt,
          riderName: users.name,
          driverName: driverProfiles.fullName,
        })
        .from(tripRatings)
        .innerJoin(users, eq(users.id, tripRatings.riderId))
        .leftJoin(driverProfiles, eq(driverProfiles.userId, tripRatings.driverId))
        .where(cond)
        .orderBy(desc(tripRatings.createdAt))
        .limit(100),
      this.db
        .select({
          driverId: tripRatings.driverId,
          driverName: driverProfiles.fullName,
          average: avg(tripRatings.stars),
          count: count(),
        })
        .from(tripRatings)
        .leftJoin(driverProfiles, eq(driverProfiles.userId, tripRatings.driverId))
        .where(cond)
        .groupBy(tripRatings.driverId, driverProfiles.fullName),
    ]);
    return {
      items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      drivers: byDriver
        .map((d) => ({ ...d, average: Math.round(Number(d.average ?? 0) * 10) / 10 }))
        .sort((a, b) => a.average - b.average),
    };
  }

  // ------------------------------------------------------------------ support

  /** The partner who should answer: the trip's, else the rider's current one, else the driver's. */
  private async partnerFor(user: AuthUser, tripId?: string): Promise<string | null> {
    if (tripId) {
      const trip = await this.db.query.trips.findFirst({ columns: { partnerId: true, riderId: true, driverId: true }, where: eq(trips.id, tripId) });
      if (!trip || (trip.riderId !== user.id && trip.driverId !== user.id)) throw new AppError('TRIP_NOT_FOUND');
      return trip.partnerId;
    }
    if (user.role === 'driver') {
      const p = await this.db.query.driverProfiles.findFirst({ columns: { partnerId: true }, where: eq(driverProfiles.userId, user.id) });
      return p?.partnerId ?? null;
    }
    const [last] = await this.db.execute<{ partner_id: string }>(
      sql`SELECT partner_id FROM subscriptions WHERE rider_id = ${user.id} ORDER BY created_at DESC LIMIT 1`,
    ).then((r) => r.rows);
    return last?.partner_id ?? null;
  }

  async openTicket(user: AuthUser, dto: { category: 'trip' | 'driver' | 'payment' | 'app' | 'other'; subject: string; message: string; tripId?: string }) {
    const partnerId = await this.partnerFor(user, dto.tripId);
    const [ticket] = await this.db
      .insert(supportTickets)
      .values({ userId: user.id, partnerId, tripId: dto.tripId ?? null, category: dto.category, subject: dto.subject.trim() })
      .returning();
    await this.db.insert(ticketMessages).values({ ticketId: ticket.id, authorId: user.id, fromStaff: false, body: dto.message.trim() });
    const staff = partnerId ? await this.notifications.partnerAdminIds(partnerId) : await this.platformAdminIds();
    await this.notifications.notify(staff, {
      kind: 'ticket_opened',
      titleAr: `طلب دعم جديد #${ticket.number}`,
      titleEn: `New support request #${ticket.number}`,
      bodyAr: ticket.subject,
      bodyEn: ticket.subject,
      data: { ticketId: ticket.id },
    });
    return this.ticket(ticket.id, user);
  }

  /**
   * The SOS button: an urgent ticket with the caller's location, alerted to the partner's team and
   * the platform team at once. The app also offers to call 911 (unified emergency number).
   */
  async sos(user: AuthUser, dto: { tripId?: string; lat?: number; lng?: number; note?: string }) {
    const partnerId = await this.partnerFor(user, dto.tripId);
    const me = await this.db.query.users.findFirst({ columns: { name: true, phone: true }, where: eq(users.id, user.id) });
    let tripLine = '';
    if (dto.tripId) {
      const trip = await this.db.query.trips.findFirst({ where: eq(trips.id, dto.tripId) });
      if (trip) tripLine = `الرحلة: ${trip.pickupName} ← ${trip.dropoffName}، الحالة: ${trip.status}`;
    }
    const where = dto.lat !== undefined && dto.lng !== undefined ? `الموقع: https://maps.google.com/?q=${dto.lat},${dto.lng}` : 'الموقع: غير متاح';
    const who = user.role === 'driver' ? 'السائق' : 'الراكب';
    const body = [`بلاغ طوارئ من ${who} ${me?.name ?? ''} (${me?.phone ?? ''})`, tripLine, where, dto.note?.trim() ?? '']
      .filter(Boolean)
      .join('\n');
    const [ticket] = await this.db
      .insert(supportTickets)
      .values({ userId: user.id, partnerId, tripId: dto.tripId ?? null, category: 'trip', subject: 'بلاغ طوارئ', urgent: true })
      .returning();
    await this.db.insert(ticketMessages).values({ ticketId: ticket.id, authorId: user.id, fromStaff: false, body });
    const staff = [...new Set([...(partnerId ? await this.notifications.partnerAdminIds(partnerId) : []), ...(await this.platformAdminIds())])];
    await this.notifications.notify(staff, {
      kind: 'sos',
      titleAr: `بلاغ طوارئ #${ticket.number}`,
      titleEn: `Emergency report #${ticket.number}`,
      bodyAr: `${who} ${me?.name ?? me?.phone ?? ''} ضغط زر الطوارئ. اتصل به الآن.`,
      bodyEn: `${user.role === 'driver' ? 'Driver' : 'Rider'} ${me?.name ?? me?.phone ?? ''} pressed the emergency button. Call now.`,
      data: { ticketId: ticket.id, tripId: dto.tripId ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null },
    });
    return { ticketId: ticket.id, number: ticket.number, emergencyNumber: '911' };
  }

  async myTickets(userId: string) {
    const rows = await this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, userId))
      .orderBy(desc(supportTickets.lastMessageAt));
    return rows.map((t) => this.presentTicket(t));
  }

  async ticket(id: string, viewer: AuthUser) {
    const t = await this.db.query.supportTickets.findFirst({ where: eq(supportTickets.id, id) });
    if (!t) throw new AppError('TICKET_NOT_FOUND');
    const staff = ['super_admin', 'partner_admin', 'dispatcher'].includes(viewer.role);
    if (staff) {
      // Partner staff see their partner's tickets; platform-level tickets are for the platform team.
      if (viewer.role !== 'super_admin' && t.partnerId !== viewer.partnerId) throw new AppError('TICKET_NOT_FOUND');
    } else if (t.userId !== viewer.id) {
      throw new AppError('TICKET_NOT_FOUND');
    }
    const messages = await this.db
      .select({ id: ticketMessages.id, fromStaff: ticketMessages.fromStaff, body: ticketMessages.body, createdAt: ticketMessages.createdAt, authorName: users.name })
      .from(ticketMessages)
      .leftJoin(users, eq(users.id, ticketMessages.authorId))
      .where(eq(ticketMessages.ticketId, id))
      .orderBy(ticketMessages.createdAt);
    const author = await this.db.query.users.findFirst({ columns: { name: true, phone: true, role: true }, where: eq(users.id, t.userId) });
    return {
      ...this.presentTicket(t),
      requester: staff && author ? { name: author.name, phone: author.phone, role: author.role } : undefined,
      messages: messages.map((m) => ({
        id: m.id,
        fromStaff: m.fromStaff,
        body: m.body,
        // Riders see "support", not which staff member answered.
        authorName: m.fromStaff && !staff ? null : m.authorName,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async reply(viewer: AuthUser, id: string, body: string) {
    await this.ticket(id, viewer); // access check
    const t = (await this.db.query.supportTickets.findFirst({ where: eq(supportTickets.id, id) }))!;
    if (t.status === 'closed') throw new AppError('TICKET_CLOSED');
    const staff = ['super_admin', 'partner_admin', 'dispatcher'].includes(viewer.role);
    await this.db.insert(ticketMessages).values({ ticketId: id, authorId: viewer.id, fromStaff: staff, body: body.trim() });
    await this.db
      .update(supportTickets)
      .set({ status: staff ? 'answered' : 'open', lastMessageAt: new Date() })
      .where(eq(supportTickets.id, id));
    if (staff) {
      await this.notifications.notify([t.userId], {
        kind: 'ticket_answered',
        titleAr: `رد على طلبك #${t.number}`,
        titleEn: `Reply to your request #${t.number}`,
        bodyAr: body.trim().slice(0, 140),
        bodyEn: body.trim().slice(0, 140),
        data: { ticketId: id },
      });
    }
    return this.ticket(id, viewer);
  }

  async close(viewer: AuthUser, id: string) {
    await this.ticket(id, viewer);
    await this.db.update(supportTickets).set({ status: 'closed' }).where(eq(supportTickets.id, id));
    return this.ticket(id, viewer);
  }

  async adminTickets(actor: AuthUser, q: { status?: string; partnerId?: string }) {
    const where: SQL[] = [];
    if (actor.role === 'super_admin') {
      if (q.partnerId) where.push(eq(supportTickets.partnerId, q.partnerId));
    } else {
      where.push(eq(supportTickets.partnerId, actor.partnerId as string));
    }
    if (q.status) where.push(sql`${supportTickets.status} = ${q.status}`);
    const rows = await this.db
      .select({ t: supportTickets, name: users.name, phone: users.phone, role: users.role })
      .from(supportTickets)
      .innerJoin(users, eq(users.id, supportTickets.userId))
      .where(where.length ? and(...where) : undefined)
      // Open emergency reports first, then the most recent activity.
      .orderBy(sql`(${supportTickets.urgent} AND ${supportTickets.status} <> 'closed') DESC`, desc(supportTickets.lastMessageAt))
      .limit(200);
    return rows.map((r) => ({ ...this.presentTicket(r.t), requester: { name: r.name, phone: r.phone, role: r.role } }));
  }

  private presentTicket(t: typeof supportTickets.$inferSelect) {
    return {
      id: t.id,
      number: t.number,
      category: t.category,
      subject: t.subject,
      status: t.status,
      urgent: t.urgent,
      tripId: t.tripId,
      partnerId: t.partnerId,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    };
  }

  private async platformAdminIds(): Promise<string[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'super_admin'), isNull(users.deletedAt)));
    return rows.map((r) => r.id);
  }

  assertPartner(actor: AuthUser, partnerId: string): void {
    assertPartnerAccess(actor, partnerId);
  }
}
