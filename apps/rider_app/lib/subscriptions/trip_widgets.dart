import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:mobile_core/mobile_core.dart';

import 'live_trip_screen.dart';
import 'models.dart';
import 'repository.dart';
import 'strings.dart';

String _when(RiderStrings t, Trip trip) {
  final today = riyadhToday();
  final tomorrow = isoDay(DateTime.parse('${today}T00:00:00').add(const Duration(days: 1)));
  final day = trip.serviceDate == today ? t.today : (trip.serviceDate == tomorrow ? t.tomorrow : t.day(trip.serviceDate));
  return '$day · ${DateFormat.Hm('en').format(trip.scheduledAt.toLocal())}';
}

void openLive(BuildContext context, Trip trip) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LiveTripScreen(tripId: trip.id)));

/// The one trip that matters now: the one in progress, or the next one.
class NextTripCard extends ConsumerWidget {
  const NextTripCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    final trips = ref.watch(tripsProvider).valueOrNull ?? const <Trip>[];
    final trip = trips.where((x) => x.active).firstOrNull ?? trips.where((x) => x.upcoming).firstOrNull;
    if (trip == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final active = trip.active;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Material(
        color: active ? Brand.ink : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => openLive(context, trip),
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: active ? null : Border.all(color: Brand.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(active ? t.tripNow : t.nextTrip,
                        style: TextStyle(color: active ? Brand.routeBright : Brand.inkSoft, fontWeight: FontWeight.w600, fontSize: 13)),
                    const Spacer(),
                    Text(_when(t, trip), style: TextStyle(color: active ? Colors.white70 : Brand.inkSoft, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  active ? t.tripStatus(trip.status) : '${trip.pickup.name}  ${t.ar ? '←' : '→'}  ${trip.dropoff.name}',
                  style: theme.textTheme.titleLarge?.copyWith(color: active ? Colors.white : Brand.ink, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  trip.driver?.name != null ? '${trip.driver!.name}${trip.driver!.plate != null ? ' · ${trip.driver!.plate}' : ''}' : t.noDriverYet,
                  style: TextStyle(color: active ? Colors.white70 : Brand.inkSoft),
                ),
                if (active) ...[
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: Brand.routeBright, foregroundColor: Brand.ink),
                    onPressed: () => openLive(context, trip),
                    icon: const Icon(Icons.near_me),
                    label: Text(t.follow),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The coming week's trips for one subscription, each skippable until shortly before it.
class UpcomingTrips extends ConsumerWidget {
  const UpcomingTrips({super.key, required this.subscriptionId});
  final String subscriptionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    final all = ref.watch(tripsProvider).valueOrNull ?? const <Trip>[];
    final trips = all.where((x) => x.subscriptionId == subscriptionId && x.serviceDate.compareTo(riyadhToday()) >= 0).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(t.upcomingTrips, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        if (trips.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(t.noUpcoming)),
        for (final trip in trips)
          ListTile(
            contentPadding: EdgeInsets.zero,
            onTap: trip.open ? () => openLive(context, trip) : null,
            leading: Icon(trip.leg == 'outbound' ? Icons.arrow_circle_up_outlined : Icons.arrow_circle_down_outlined,
                color: trip.open ? Brand.route : Brand.inkSoft),
            title: Text('${trip.leg == 'outbound' ? t.outbound : t.returnLeg} · ${_when(t, trip)}'),
            subtitle: Text(t.tripStatus(trip.status)),
            trailing: trip.upcoming && trip.scheduledAt.difference(DateTime.now()).inMinutes > 30
                ? TextButton(onPressed: () => _skip(context, ref, trip), child: Text(t.skipTrip, style: const TextStyle(fontSize: 12)))
                : null,
          ),
      ],
    );
  }

  Future<void> _skip(BuildContext context, WidgetRef ref, Trip trip) async {
    final t = RiderStrings.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t.skipTrip),
        content: Text(t.skipConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.back)),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(t.confirm)),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(riderRepositoryProvider).skip(trip.id);
      ref.invalidate(tripsProvider);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t.skipped)));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
    }
  }
}
