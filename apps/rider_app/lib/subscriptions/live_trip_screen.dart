import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:latlong2/latlong.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:url_launcher/url_launcher.dart';

import 'models.dart';
import 'repository.dart';
import 'strings.dart';

/// Follow the driver: the map shows the car moving to the pick-up (then the drop-off), the panel
/// says what is happening in words, with the driver, the plate and a call button.
/// Refreshes every 5 seconds while open.
class LiveTripScreen extends ConsumerStatefulWidget {
  const LiveTripScreen({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<LiveTripScreen> createState() => _LiveTripScreenState();
}

class _LiveTripScreenState extends ConsumerState<LiveTripScreen> {
  final _map = MapController();
  LiveTrip? _live;
  Object? _error;
  Timer? _timer;
  bool _userMovedMap = false;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final live = await ref.read(riderRepositoryProvider).live(widget.tripId);
      if (!mounted) return;
      setState(() {
        _live = live;
        _error = null;
      });
      if (!live.trip.open) _timer?.cancel();
      _fit(live);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _fit(LiveTrip live) {
    if (_userMovedMap) return;
    final target = live.trip.status == 'on_board' ? live.trip.dropoff : live.trip.pickup;
    final points = [
      LatLng(target.lat, target.lng),
      if (live.driverLat != null) LatLng(live.driverLat!, live.driverLng!) else LatLng(live.trip.dropoff.lat, live.trip.dropoff.lng),
    ];
    try {
      _map.fitCamera(CameraFit.coordinates(coordinates: points, padding: const EdgeInsets.fromLTRB(48, 48, 48, 320), maxZoom: 16));
    } catch (_) {
      // The map is not laid out yet; the next refresh fits it.
    }
  }

  @override
  Widget build(BuildContext context) {
    final live = _live;
    if (live == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error == null ? const CircularProgressIndicator() : Text(describeError(context, _error!), textAlign: TextAlign.center),
        ),
      );
    }
    final trip = live.trip;
    final pickup = LatLng(trip.pickup.lat, trip.pickup.lng);
    final dropoff = LatLng(trip.dropoff.lat, trip.dropoff.lng);
    final car = live.driverLat == null ? null : LatLng(live.driverLat!, live.driverLng!);

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        leading: Padding(
          padding: const EdgeInsets.all(6),
          child: CircleAvatar(backgroundColor: Colors.white, child: BackButton(color: Brand.ink, onPressed: () => Navigator.of(context).pop())),
        ),
      ),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: car ?? pickup,
              initialZoom: 15,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
              onPositionChanged: (_, hasGesture) {
                if (hasGesture) _userMovedMap = true;
              },
              onMapReady: () => _fit(live),
            ),
            children: [
              TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'sa.ride.rider'),
              PolylineLayer(polylines: [
                Polyline(points: [pickup, dropoff], strokeWidth: 3, color: const Color(0x800B6E4F), pattern: StrokePattern.dashed(segments: const [8, 6])),
                if (car != null && trip.active)
                  Polyline(points: [car, trip.status == 'on_board' ? dropoff : pickup], strokeWidth: 4, color: Brand.route),
              ]),
              MarkerLayer(markers: [
                Marker(point: pickup, width: 22, height: 22, child: const _Stop(filled: false)),
                Marker(point: dropoff, width: 26, height: 26, child: const _Stop(filled: true)),
                if (car != null)
                  Marker(
                    point: car,
                    width: 44,
                    height: 44,
                    child: Transform.rotate(angle: (live.heading ?? 0) * math.pi / 180, child: const _Car()),
                  ),
              ]),
            ],
          ),
          if (_userMovedMap)
            PositionedDirectional(
              end: 16,
              bottom: 300,
              child: FloatingActionButton.small(
                heroTag: 'recenter',
                backgroundColor: Colors.white,
                foregroundColor: Brand.ink,
                onPressed: () {
                  setState(() => _userMovedMap = false);
                  _fit(live);
                },
                child: const Icon(Icons.center_focus_strong),
              ),
            ),
          Align(alignment: Alignment.bottomCenter, child: _Panel(live: live)),
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.live});
  final LiveTrip live;

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    final trip = live.trip;
    final theme = Theme.of(context);
    final (headline, detail) = switch (trip.status) {
      'scheduled' => (t.tripScheduled(DateFormat.Hm('en').format(trip.scheduledAt.toLocal())), t.tripScheduledBody),
      'en_route' => (live.etaMinutes == null ? t.driverOnWay : t.arrivesIn(live.etaMinutes!), t.getReady),
      'arrived' => (t.driverArrived, t.driverWaiting(trip.pickup.name)),
      'on_board' => (live.etaMinutes == null ? t.onTheWayTo(trip.dropoff.name) : t.reachIn(live.etaMinutes!), t.onTheWayTo(trip.dropoff.name)),
      'completed' => (t.arrivedSafely, t.arrivedAt(trip.dropoff.name)),
      _ => (t.tripStatus(trip.status), ''),
    };
    final driver = trip.driver;

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 16, offset: Offset(0, -4))],
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Brand.line, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 14),
            Text(headline, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            if (detail.isNotEmpty) ...[const SizedBox(height: 4), Text(detail, style: theme.textTheme.bodyMedium)],
            const SizedBox(height: 14),
            _Progress(trip: trip),
            if (driver != null) ...[
              const Divider(height: 28),
              Row(
                children: [
                  const CircleAvatar(radius: 22, backgroundColor: Color(0xFFE7F3EE), child: Icon(Icons.person, color: Brand.route)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(driver.name ?? t.yourDriver, style: theme.textTheme.titleMedium),
                        if (driver.vehicle != null) Text(driver.vehicle!, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (driver.plate != null) _Plate(driver.plate!),
                  if (driver.phone != null) ...[
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: t.callDriver,
                      onPressed: () => launchUrl(Uri.parse('tel:${driver.phone}')),
                      icon: const Icon(Icons.call),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress({required this.trip});
  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    final steps = [
      (t.stepOnWay, trip.startedAt),
      (t.stepArrived, trip.arrivedAt),
      (t.stepOnBoard, trip.pickedUpAt),
      (t.stepDone, trip.completedAt),
    ];
    String time(DateTime? d) => d == null ? '' : DateFormat.Hm('en').format(d.toLocal());
    return Row(
      children: [
        for (final (label, at) in steps)
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(height: 4, margin: const EdgeInsetsDirectional.only(end: 4), color: at != null ? Brand.route : Brand.line),
                const SizedBox(height: 6),
                Text(label, style: TextStyle(fontSize: 12, color: at != null ? Brand.ink : Brand.inkSoft, fontWeight: FontWeight.w600)),
                Text(time(at), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 11, color: Brand.inkSoft)),
              ],
            ),
          ),
      ],
    );
  }
}

/// The plate as it appears on the car: digits then Latin letters.
class _Plate extends StatelessWidget {
  const _Plate(this.value);
  final String value;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(border: Border.all(color: Brand.ink, width: 2), borderRadius: BorderRadius.circular(4)),
        child: Text(value, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1)),
      );
}

class _Car extends StatelessWidget {
  const _Car();

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Brand.route,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 6)],
        ),
        child: const Icon(Icons.navigation, color: Colors.white, size: 22),
      );
}

class _Stop extends StatelessWidget {
  const _Stop({required this.filled});
  final bool filled;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: filled ? Brand.route : Colors.white,
          border: Border.all(color: Brand.route, width: 4),
        ),
      );
}
