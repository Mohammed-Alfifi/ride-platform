import { decodeZatcaQr, vatIncluded, zatcaQr } from './zatca';

describe('ZATCA QR', () => {
  it('encodes the five fields as TLV and round-trips', () => {
    const qr = zatcaQr({
      sellerName: 'شركة النقل المتحدة',
      vatNumber: '310122393500003',
      timestamp: new Date('2026-10-17T10:30:00.000Z'),
      totalHalalas: 120000,
      vatHalalas: 15652,
    });
    expect(decodeZatcaQr(qr)).toEqual(['شركة النقل المتحدة', '310122393500003', '2026-10-17T10:30:00Z', '1200.00', '156.52']);
    // First byte is tag 1, second the UTF-8 byte length of the Arabic name.
    const raw = Buffer.from(qr, 'base64');
    expect(raw[0]).toBe(1);
    expect(raw[1]).toBe(Buffer.byteLength('شركة النقل المتحدة', 'utf8'));
  });

  it('extracts VAT from a VAT-inclusive price', () => {
    expect(vatIncluded(115000, 1500)).toBe(15000);
    expect(vatIncluded(120000, 1500)).toBe(15652);
    expect(vatIncluded(120000, 0)).toBe(0);
  });
});
