import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:mobile_core/mobile_core.dart';

/// Shares the driver's position while the trips screen is open: points are collected as the
/// car moves and sent every 10 seconds. Riders see the driver only during their own trip.
class LocationReporter {
  LocationReporter(this._api);

  final ApiClient _api;
  final List<Map<String, Object>> _buffer = [];
  StreamSubscription<Position>? _sub;
  Timer? _timer;
  Position? last;

  bool get running => _sub != null;

  /// Returns false when the driver refuses location access or it is turned off.
  Future<bool> start() async {
    if (running) return true;
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) return false;

    _sub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 15),
    ).listen(_add);
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => flush());
    try {
      _add(await Geolocator.getCurrentPosition());
      await flush();
    } catch (_) {
      // The stream will deliver the first fix.
    }
    return true;
  }

  void _add(Position p) {
    last = p;
    _buffer.add({
      'lat': p.latitude,
      'lng': p.longitude,
      if (p.heading >= 0) 'heading': p.heading.clamp(0, 360),
      if (p.speed >= 0) 'speedKmh': (p.speed * 3.6).clamp(0, 250),
      'at': p.timestamp.toUtc().toIso8601String(),
    });
    if (_buffer.length > 60) _buffer.removeRange(0, _buffer.length - 60);
  }

  Future<void> flush() async {
    if (_buffer.isEmpty) return;
    final points = List<Map<String, Object>>.from(_buffer);
    _buffer.clear();
    try {
      await _api.post('/v1/driver/location', data: {'points': points});
    } catch (_) {
      // Offline: keep the newest points for the next attempt.
      _buffer.insertAll(0, points.length > 30 ? points.sublist(points.length - 30) : points);
    }
  }

  Future<void> stop() async {
    await flush();
    await _sub?.cancel();
    _sub = null;
    _timer?.cancel();
    _timer = null;
  }
}
