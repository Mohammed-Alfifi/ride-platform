import 'package:driver_app/onboarding/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Completes 9 digits with the right check digit, like the server's rule.
String withCheckDigit(String first9) {
  for (var d = 0; d <= 9; d++) {
    if (isValidSaudiNationalId('$first9$d')) return '$first9$d';
  }
  throw StateError('no check digit');
}

void main() {
  test('validates Saudi national IDs with the check digit', () {
    final id = withCheckDigit('101234567');
    expect(isValidSaudiNationalId(id), isTrue);
    final wrong = id.substring(0, 9) + '${(int.parse(id[9]) + 1) % 10}';
    expect(isValidSaudiNationalId(wrong), isFalse);
    expect(isValidSaudiNationalId('2${id.substring(1)}'), isFalse);
    expect(isValidSaudiNationalId('123'), isFalse);
  });

  test('parses the onboarding response', () {
    final o = Onboarding.fromJson({
      'status': 'rejected',
      'partner': {'id': 'p1', 'nameAr': 'شريك', 'nameEn': 'Partner'},
      'profile': {'fullName': 'سائق', 'nationalIdLast4': '1234', 'dateOfBirth': '1990-01-01', 'saudiConfirmed': true},
      'vehicle': {
        'id': 'v1',
        'plateLetters': 'ABJ',
        'plateNumbers': '1234',
        'make': 'Toyota',
        'model': 'Camry',
        'year': 2024,
        'color': 'أبيض',
        'seats': 4,
        'eligibleUntil': '2029-01-01',
      },
      'documents': [
        {'id': 'd1', 'type': 'driving_license', 'status': 'rejected', 'expiresAt': '2027-01-01', 'rejectionReason': 'غير واضحة'},
      ],
      'requirements': [],
      'missing': ['document.driving_license'],
      'canSubmit': false,
      'rejectionReason': 'أعد رفع الرخصة',
      'complianceHold': false,
      'complianceReason': null,
    });
    expect(o.editable, isTrue);
    expect(o.details!.complete, isTrue);
    expect(o.vehicle!.year, 2024);
    expect(o.document('driving_license')!.rejectionReason, 'غير واضحة');
    expect(o.document('national_id'), isNull);
    expect(o.partner!.nameEn, 'Partner');
  });
}
