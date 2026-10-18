import 'package:driver_app/trips/models.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> trip(String status) => {
      'id': 't1',
      'leg': 'outbound',
      'scheduledAt': '2026-10-19T03:30:00.000Z',
      'status': status,
      'pickup': {'lat': 24.86, 'lng': 46.82, 'name': 'البيت'},
      'dropoff': {'lat': 24.87, 'lng': 46.83, 'name': 'المدرسة'},
      'rider': {'id': 'r1', 'name': 'نورة', 'phone': '+966501234567'},
      'arrivedAt': null,
    };

void main() {
  test('heads to the pick-up until the rider is on board, then to the drop-off', () {
    expect(DriverTrip.fromJson(trip('en_route')).target.name, 'البيت');
    expect(DriverTrip.fromJson(trip('on_board')).target.name, 'المدرسة');
  });

  test('knows which trips are still open', () {
    expect(DriverTrip.fromJson(trip('scheduled')).open, isTrue);
    expect(DriverTrip.fromJson(trip('arrived')).active, isTrue);
    expect(DriverTrip.fromJson(trip('completed')).open, isFalse);
    expect(DriverTrip.fromJson(trip('skipped')).open, isFalse);
  });
}
