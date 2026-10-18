import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'models.dart';

/// Today's trips for the signed-in driver, refreshed after every action.
class TodayTrips extends AsyncNotifier<List<DriverTrip>> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<List<DriverTrip>> build() async => (await _api.getList('/v1/driver/trips')).map(DriverTrip.fromJson).toList();

  Future<void> refresh() async => state = await AsyncValue.guard(build);

  /// action: start | arrive | pickup | complete | no-show. Errors go to the screen that asked.
  Future<void> act(String tripId, String action) async {
    final updated = DriverTrip.fromJson(await _api.post('/v1/driver/trips/$tripId/$action'));
    final list = state.valueOrNull ?? const [];
    state = AsyncData([for (final t in list) t.id == updated.id ? updated : t]);
  }
}

final todayTripsProvider = AsyncNotifierProvider<TodayTrips, List<DriverTrip>>(TodayTrips.new);
