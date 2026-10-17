import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { AppError } from '../common/errors';
import { ENV } from '../config/config.module';
import { Env } from '../config/env';
import { DB, Database } from '../database/database.module';
import { Invoice, invoices, invoiceSequences, partners, PaymentRow, users } from '../database/schema';
import { vatIncluded, zatcaQr } from './zatca';

export interface InvoiceView {
  id: string;
  number: string;
  issuedAt: string;
  sellerName: string;
  sellerVatNumber: string | null;
  buyerName: string | null;
  description: string;
  totalHalalas: number;
  vatHalalas: number;
  /** Simplified tax invoice when the seller is VAT-registered; otherwise a receipt. */
  kind: 'simplified_tax_invoice' | 'receipt';
  qrTlv: string | null;
}

/**
 * Issues one invoice per paid payment. The seller is the transport partner (who provides the
 * service); the invoice carries their VAT number and the ZATCA QR. Numbers are sequential per year.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issue(payment: PaymentRow, description: string): Promise<Invoice> {
    const existing = await this.db.query.invoices.findFirst({ where: eq(invoices.paymentId, payment.id) });
    if (existing) return existing;

    const partner = await this.db.query.partners.findFirst({ where: eq(partners.id, payment.partnerId) });
    const rider = await this.db.query.users.findFirst({ columns: { name: true, phone: true }, where: eq(users.id, payment.riderId) });
    if (!partner) throw new AppError('PARTNER_NOT_FOUND');

    const issuedAt = payment.paidAt ?? new Date();
    const sellerName = partner.legalName ?? partner.nameAr;
    const vatNumber = partner.vatNumber;
    const vat = vatNumber ? vatIncluded(payment.amountHalalas, this.env.VAT_RATE_BPS) : 0;
    const year = Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric' }).format(issuedAt),
    );

    return this.db.transaction(async (tx) => {
      const [seq] = await tx
        .insert(invoiceSequences)
        .values({ year, last: 1 })
        .onConflictDoUpdate({ target: invoiceSequences.year, set: { last: sql`${invoiceSequences.last} + 1` } })
        .returning();
      const [row] = await tx
        .insert(invoices)
        .values({
          paymentId: payment.id,
          partnerId: payment.partnerId,
          riderId: payment.riderId,
          number: `INV-${year}-${String(seq.last).padStart(6, '0')}`,
          sellerName,
          sellerVatNumber: vatNumber,
          buyerName: rider?.name ?? rider?.phone ?? null,
          description,
          totalHalalas: payment.amountHalalas,
          vatHalalas: vat,
          qrTlv: vatNumber
            ? zatcaQr({ sellerName, vatNumber, timestamp: issuedAt, totalHalalas: payment.amountHalalas, vatHalalas: vat })
            : null,
          issuedAt,
        })
        .onConflictDoNothing({ target: invoices.paymentId })
        .returning();
      // A concurrent caller issued it first; that one stands (the sequence number is simply skipped).
      return row ?? ((await tx.query.invoices.findFirst({ where: eq(invoices.paymentId, payment.id) })) as Invoice);
    });
  }

  present(inv: Invoice): InvoiceView {
    return {
      id: inv.id,
      number: inv.number,
      issuedAt: inv.issuedAt.toISOString(),
      sellerName: inv.sellerName,
      sellerVatNumber: inv.sellerVatNumber,
      buyerName: inv.buyerName,
      description: inv.description,
      totalHalalas: inv.totalHalalas,
      vatHalalas: inv.vatHalalas,
      kind: inv.sellerVatNumber ? 'simplified_tax_invoice' : 'receipt',
      qrTlv: inv.qrTlv,
    };
  }

  /** A printable bilingual invoice page. */
  async html(inv: Invoice): Promise<string> {
    const sar = (h: number) => (h / 100).toFixed(2);
    const qr = inv.qrTlv ? await QRCode.toString(inv.qrTlv, { type: 'svg', margin: 0, width: 160 }) : '';
    const title = inv.sellerVatNumber ? 'فاتورة ضريبية مبسطة · Simplified Tax Invoice' : 'إيصال · Receipt';
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(inv.issuedAt);
    const esc = (s: string | null) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.number)}</title>
<style>body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#18263a;max-width:560px;margin:24px auto;padding:0 16px}
h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 0;border-bottom:1px solid #d9e0e4}
td:last-child{text-align:left;direction:ltr}.muted{color:#4a5a6e;font-size:14px}.total td{font-weight:700;border-bottom:0}.qr{margin-top:16px}</style></head>
<body><h1>${title}</h1><div class="muted">${esc(inv.number)} · ${date}</div>
<table><tr><td>البائع · Seller</td><td>${esc(inv.sellerName)}</td></tr>
${inv.sellerVatNumber ? `<tr><td>الرقم الضريبي · VAT No.</td><td>${esc(inv.sellerVatNumber)}</td></tr>` : ''}
<tr><td>العميل · Customer</td><td>${esc(inv.buyerName)}</td></tr>
<tr><td>الوصف · Description</td><td>${esc(inv.description)}</td></tr>
<tr><td>المبلغ قبل الضريبة · Subtotal</td><td>${sar(inv.totalHalalas - inv.vatHalalas)} SAR</td></tr>
<tr><td>ضريبة القيمة المضافة · VAT</td><td>${sar(inv.vatHalalas)} SAR</td></tr>
<tr class="total"><td>الإجمالي · Total</td><td>${sar(inv.totalHalalas)} SAR</td></tr></table>
${qr ? `<div class="qr">${qr}</div>` : ''}</body></html>`;
  }
}
