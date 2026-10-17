import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/subscriptions/models.dart';
import 'package:rider_app/subscriptions/repository.dart';
import 'package:rider_app/subscriptions/strings.dart';

Map<String, dynamic> place(String id, String label) =>
    {'id': id, 'label': label, 'name': label, 'lat': 24.8675, 'lng': 46.8275, 'address': null};

void main() {
  test('reads a subscription as the API sends it', () {
    final s = Subscription.fromJson({
      'id': 's1',
      'status': 'past_due',
      'planId': 'p1',
      'planNameAr': 'ذهاب وعودة',
      'planNameEn': 'Round trip',
      'partnerNameAr': 'الرمال',
      'partnerNameEn': 'Rimal',
      'pickup': place('a', 'home'),
      'dropoff': place('b', 'school'),
      'days': [0, 1, 2, 3, 4],
      'outboundTime': '06:30',
      'returnTime': '13:30',
      'distanceKm': 3,
      'priceHalalas': 115000,
      'currentPeriodStart': '2026-10-18',
      'currentPeriodEnd': '2026-11-17',
      'autoRenew': true,
      'cancelAtPeriodEnd': false,
      'pausedFrom': '2026-10-20',
      'pausedUntil': '2026-10-25',
      'card': {'id': 'c1', 'brand': 'MADA', 'last4': '4242'},
      'payUrl': 'https://pay',
      'pendingPaymentId': 'pay1',
      'createdAt': '2026-10-17T10:00:00.000Z',
    });
    expect(s.needsPayment, isTrue);
    expect(s.live, isTrue);
    expect(s.card!.last4, '4242');
    expect(s.pauseOpen('2026-10-22'), isTrue);
    expect(s.pauseOpen('2026-10-26'), isFalse);
  });

  test('quotes and coverage', () {
    final q = Quote.fromJson({'eligible': false, 'reason': 'PLAN_DISTANCE_EXCEEDED', 'distanceKm': 21, 'maxDistanceKm': 15, 'priceHalalas': 115000, 'vatHalalas': 15000});
    expect(q.eligible, isFalse);
    final c = Coverage.fromJson({
      'zoneNameAr': 'الرمال',
      'zoneNameEn': 'Rimal',
      'partnerNameAr': 'أ',
      'partnerNameEn': 'A',
      'plans': [
        {'id': 'p', 'nameAr': 'ب', 'nameEn': 'B', 'tripType': 'one_way', 'daysPerWeek': 6, 'priceHalalas': 75000, 'maxDistanceKm': 10},
      ],
    });
    expect(c.plans.single.roundTrip, isFalse);
  });

  test('Riyadh calendar day and money', () {
    expect(riyadhToday(DateTime.utc(2026, 10, 17, 21, 30)), '2026-10-18');
    expect(riyadhToday(DateTime.utc(2026, 10, 17, 20, 59)), '2026-10-17');
    const t = RiderStrings(true);
    expect(t.sar(115000), '1,150');
    expect(t.sar(97750), '977.50');
    expect(t.daysList([0, 4]), 'الأحد، الخميس');
  });
}
