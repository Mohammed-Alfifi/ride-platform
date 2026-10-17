import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile_core/mobile_core.dart';

import 'models.dart';
import 'repository.dart';
import 'strings.dart';

/// Adds a place by moving the map under a fixed pin, the way riders point a driver to a gate.
/// Pops with the saved [Place].
class PlacePickerScreen extends ConsumerStatefulWidget {
  const PlacePickerScreen({super.key, this.initialLabel = 'home', this.center});

  final String initialLabel;
  final LatLng? center;

  @override
  ConsumerState<PlacePickerScreen> createState() => _PlacePickerScreenState();
}

class _PlacePickerScreenState extends ConsumerState<PlacePickerScreen> {
  static const _riyadh = LatLng(24.7136, 46.6753);
  final _map = MapController();
  final _name = TextEditingController();
  late String _label = widget.initialLabel;
  late LatLng _point = widget.center ?? _riyadh;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final t = RiderStrings.of(context);
    final name = _name.text.trim().isEmpty ? t.placeLabel(_label) : _name.text.trim();
    setState(() => _saving = true);
    try {
      final place = await ref
          .read(riderRepositoryProvider)
          .addPlace(label: _label, name: name, lat: _point.latitude, lng: _point.longitude);
      ref.invalidate(placesProvider);
      if (mounted) Navigator.of(context).pop(place);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.addPlace)),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: _point,
                    initialZoom: widget.center == null ? 11 : 16,
                    minZoom: 5,
                    maxZoom: 19,
                    interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
                    onPositionChanged: (camera, _) => _point = camera.center,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'sa.ride.rider',
                    ),
                    const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
                  ],
                ),
                // The pin's tip sits on the map centre.
                const IgnorePointer(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 40),
                    child: Icon(Icons.location_on, size: 44, color: Brand.route),
                  ),
                ),
                Positioned(
                  top: 12,
                  left: 12,
                  right: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: Brand.line)),
                    child: Text(t.moveMapHint, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final l in const ['home', 'school', 'work', 'other'])
                        ChoiceChip(
                          label: Text(t.placeLabel(l)),
                          selected: _label == l,
                          onSelected: (_) => setState(() => _label = l),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _name,
                    maxLength: 80,
                    decoration: InputDecoration(labelText: t.placeName, hintText: t.placeNameHint, counterText: ''),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _saving ? null : _save, child: _saving ? const ButtonSpinner() : Text(t.savePlace)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A small read-only map showing the two ends of a trip.
class RouteMap extends StatelessWidget {
  const RouteMap({super.key, required this.from, required this.to, this.height = 180});

  final Place from;
  final Place to;
  final double height;

  @override
  Widget build(BuildContext context) {
    final a = LatLng(from.lat, from.lng);
    final b = LatLng(to.lat, to.lng);
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        height: height,
        child: FlutterMap(
          options: MapOptions(
            initialCameraFit: CameraFit.coordinates(coordinates: [a, b], padding: const EdgeInsets.all(36), maxZoom: 16),
            interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
          ),
          children: [
            TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'sa.ride.rider'),
            PolylineLayer(polylines: [
              Polyline(points: [a, b], strokeWidth: 3, color: Brand.routeBright, pattern: StrokePattern.dashed(segments: const [8, 6])),
            ]),
            MarkerLayer(markers: [
              Marker(point: a, width: 18, height: 18, child: const _Dot(filled: false)),
              Marker(point: b, width: 22, height: 22, child: const _Dot(filled: true)),
            ]),
          ],
        ),
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.filled});
  final bool filled;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: filled ? Brand.route : Colors.white,
          border: Border.all(color: Brand.route, width: 3),
        ),
      );
}
