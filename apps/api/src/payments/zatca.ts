/**
 * ZATCA simplified tax invoice QR (phase 1 format): TLV fields, base64 encoded.
 * 1 seller name, 2 VAT registration number, 3 timestamp, 4 invoice total (with VAT), 5 VAT total.
 */
export function zatcaQr(fields: {
  sellerName: string;
  vatNumber: string;
  timestamp: Date;
  totalHalalas: number;
  vatHalalas: number;
}): string {
  const values = [
    fields.sellerName,
    fields.vatNumber,
    fields.timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    (fields.totalHalalas / 100).toFixed(2),
    (fields.vatHalalas / 100).toFixed(2),
  ];
  const parts = values.map((value, i) => {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > 255) throw new Error(`QR field ${i + 1} is too long`);
    return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
  });
  return Buffer.concat(parts).toString('base64');
}

/** VAT contained in a VAT-inclusive amount: total * rate / (1 + rate), rounded to the halala. */
export function vatIncluded(totalHalalas: number, rateBps: number): number {
  return Math.round((totalHalalas * rateBps) / (10_000 + rateBps));
}

/** Reads a TLV payload back; used by tests and to show invoice data. */
export function decodeZatcaQr(base64: string): string[] {
  const buf = Buffer.from(base64, 'base64');
  const out: string[] = [];
  let i = 0;
  while (i < buf.length) {
    const len = buf[i + 1];
    out.push(buf.subarray(i + 2, i + 2 + len).toString('utf8'));
    i += 2 + len;
  }
  return out;
}
