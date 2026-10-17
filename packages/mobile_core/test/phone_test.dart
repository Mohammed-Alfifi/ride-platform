import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/mobile_core.dart';

void main() {
  group('normalizeSaudiMobile', () {
    for (final input in [
      '0501234567',
      '501234567',
      '966501234567',
      '+966501234567',
      '00966501234567',
      '050 123 4567',
      '050-123-4567',
      '٠٥٠١٢٣٤٥٦٧',
    ]) {
      test('accepts $input', () => expect(normalizeSaudiMobile(input), '+966501234567'));
    }

    for (final input in ['0112345678', '12345', '+201001234567', '']) {
      test('rejects "$input"', () => expect(normalizeSaudiMobile(input), isNull));
    }
  });

  test('formats for display', () {
    expect(formatSaudiMobile('+966501234567'), '050 123 4567');
  });
}
