import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'models.dart';

/// Everything the rider app asks the API about places, plans, subscriptions and payments.
class RiderRepository {
  RiderRepository(this._api);
  final ApiClient _api;

  Future<List<Place>> places() async => (await _api.getList('/v1/places')).map(Place.fromJson).toList();

  Future<Place> addPlace({required String label, required String name, required double lat, required double lng}) async =>
      Place.fromJson(await _api.post('/v1/places', data: {'label': label, 'name': name, 'lat': lat, 'lng': lng}));

  Future<void> removePlace(String id) => _api.delete('/v1/places/$id');

  Future<List<Coverage>> coverage(Place at) async =>
      (await _api.getList('/v1/coverage', query: {'lat': at.lat, 'lng': at.lng})).map(Coverage.fromJson).toList();

  Future<Quote> quote({required String planId, required String pickupId, required String dropoffId}) async => Quote.fromJson(
        await _api.post('/v1/quotes', data: {'planId': planId, 'pickupPlaceId': pickupId, 'dropoffPlaceId': dropoffId}),
      );

  /// Creates the subscription and returns it with the payment page to open.
  Future<(Subscription, Payment)> subscribe({
    required String planId,
    required String pickupId,
    required String dropoffId,
    required List<int> days,
    required String outboundTime,
    String? returnTime,
    bool saveCard = true,
  }) async {
    final body = await _api.post('/v1/subscriptions', data: {
      'planId': planId,
      'pickupPlaceId': pickupId,
      'dropoffPlaceId': dropoffId,
      'days': days,
      'outboundTime': outboundTime,
      if (returnTime != null) 'returnTime': returnTime,
      'saveCard': saveCard,
    });
    return (
      Subscription.fromJson(body['subscription'] as Map<String, dynamic>),
      Payment.fromJson({...body['payment'] as Map<String, dynamic>, 'failureReason': null, 'invoiceId': null}),
    );
  }

  Future<List<Subscription>> subscriptions() async =>
      (await _api.getList('/v1/subscriptions')).map(Subscription.fromJson).toList();

  Future<Subscription> subscription(String id) async => Subscription.fromJson(await _api.get('/v1/subscriptions/$id'));

  Future<Payment> payNow(String id) async => Payment.fromJson(await _api.post('/v1/subscriptions/$id/pay'));

  Future<Subscription> pause(String id, String from, String until) async =>
      Subscription.fromJson(await _api.post('/v1/subscriptions/$id/pause', data: {'from': from, 'until': until}));

  Future<Subscription> resume(String id) async => Subscription.fromJson(await _api.post('/v1/subscriptions/$id/resume'));

  Future<Subscription> cancel(String id) async => Subscription.fromJson(await _api.post('/v1/subscriptions/$id/cancel'));

  Future<Subscription> keep(String id) async => Subscription.fromJson(await _api.post('/v1/subscriptions/$id/keep'));

  /// Asks the server for the payment's state; the server confirms it with the gateway first.
  Future<Payment> payment(String id) async => Payment.fromJson(await _api.get('/v1/payments/$id'));

  /// Polls after the payment page closes until the gateway gives a final answer.
  Future<Payment> waitForPayment(String id, {int attempts = 8}) async {
    var p = await payment(id);
    for (var i = 1; i < attempts && p.status == 'initiated'; i++) {
      await Future<void>.delayed(Duration(milliseconds: 800 * i));
      p = await payment(id);
    }
    return p;
  }

  Future<List<SavedCard>> cards() async => (await _api.getList('/v1/payment-methods')).map(SavedCard.fromJson).toList();

  Future<void> removeCard(String id) => _api.delete('/v1/payment-methods/$id');

  Future<List<Invoice>> invoices() async => (await _api.getList('/v1/invoices')).map(Invoice.fromJson).toList();

  /// The printable invoice is an authenticated page; the web view sends the token as a header.
  Future<(Uri, Map<String, String>)> invoicePage(String id, String baseUrl) async {
    final token = await _api.accessToken();
    return (Uri.parse('$baseUrl/v1/invoices/$id'), {if (token != null) 'Authorization': 'Bearer $token'});
  }
}

final riderRepositoryProvider = Provider<RiderRepository>((ref) => RiderRepository(ref.watch(apiClientProvider)));

final placesProvider = FutureProvider.autoDispose<List<Place>>((ref) => ref.watch(riderRepositoryProvider).places());

final subscriptionsProvider =
    FutureProvider.autoDispose<List<Subscription>>((ref) => ref.watch(riderRepositoryProvider).subscriptions());

final subscriptionProvider = FutureProvider.autoDispose
    .family<Subscription, String>((ref, id) => ref.watch(riderRepositoryProvider).subscription(id));

final cardsProvider = FutureProvider.autoDispose<List<SavedCard>>((ref) => ref.watch(riderRepositoryProvider).cards());

final invoicesProvider = FutureProvider.autoDispose<List<Invoice>>((ref) => ref.watch(riderRepositoryProvider).invoices());

/// Today in Riyadh as YYYY-MM-DD; subscription dates are calendar days in Saudi time.
String riyadhToday([DateTime? now]) {
  final t = (now ?? DateTime.now()).toUtc().add(const Duration(hours: 3));
  return '${t.year.toString().padLeft(4, '0')}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

String isoDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
