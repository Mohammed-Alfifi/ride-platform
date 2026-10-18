import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:url_launcher/url_launcher.dart';

import 'location_reporter.dart';
import 'models.dart';
import 'trips_controller.dart';

/// The driver's day: the next trip large, with one obvious button for the next step,
/// and the rest of the day below. Built to be used at a glance from a phone holder.
class TodayView extends ConsumerStatefulWidget {
  const TodayView({super.key});

  @override
  ConsumerState<TodayView> createState() => _TodayViewState();
}

class _TodayViewState extends ConsumerState<TodayView> with WidgetsBindingObserver {
  late final LocationReporter _reporter = LocationReporter(ref.read(apiClientProvider));
  bool? _sharing;
  Timer? _refresh;
  String? _busy;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startSharing();
    // Picks up trips the dispatcher assigns or riders cancel during the day.
    _refresh = Timer.periodic(const Duration(minutes: 1), (_) => ref.read(todayTripsProvider.notifier).refresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refresh?.cancel();
    _reporter.stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startSharing();
      ref.read(todayTripsProvider.notifier).refresh();
    }
  }

  Future<void> _startSharing() async {
    final ok = await _reporter.start();
    if (mounted) setState(() => _sharing = ok);
  }

  Future<void> _act(DriverTrip trip, String action) async {
    setState(() => _busy = trip.id);
    try {
      await _reporter.flush(); // the server checks distance against the latest position
      await ref.read(todayTripsProvider.notifier).act(trip.id, action);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    final trips = ref.watch(todayTripsProvider);
    return trips.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.all(24), child: Text(describeError(context, e), textAlign: TextAlign.center)),
          OutlinedButton(onPressed: () => ref.read(todayTripsProvider.notifier).refresh(), child: Text(Strings.of(context).retry)),
        ]),
      ),
      data: (list) {
        final next = list.where((x) => x.active).firstOrNull ?? list.where((x) => x.open).firstOrNull;
        final done = list.where((x) => !x.open).length;
        return RefreshIndicator(
          onRefresh: () => ref.read(todayTripsProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              _DayHeader(total: list.length, done: done, sharing: _sharing, onRetrySharing: _startSharing),
              const SizedBox(height: 12),
              if (list.isEmpty) _Empty(text: t.noTrips),
              if (list.isNotEmpty && next == null) _Empty(text: t.allDone),
              if (next != null) _NextTripCard(trip: next, busy: _busy == next.id, onAct: (a) => _act(next, a)),
              if (list.length > 1) ...[
                const SizedBox(height: 24),
                Text(t.restOfDay, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final x in list)
                  if (x.id != next?.id) _TripRow(trip: x),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _DayHeader extends StatelessWidget {
  const _DayHeader({required this.total, required this.done, required this.sharing, required this.onRetrySharing});
  final int total;
  final int done;
  final bool? sharing;
  final VoidCallback onRetrySharing;

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    return Row(
      children: [
        Expanded(
          child: Text(t.progress(done, total), style: Theme.of(context).textTheme.bodyMedium),
        ),
        if (sharing == true)
          Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.my_location, size: 16, color: Brand.route),
            const SizedBox(width: 4),
            Text(t.sharing, style: const TextStyle(color: Brand.route, fontSize: 13, fontWeight: FontWeight.w600)),
          ]),
        if (sharing == false)
          TextButton.icon(
            onPressed: onRetrySharing,
            icon: const Icon(Icons.location_disabled, size: 16, color: Brand.red),
            label: Text(t.notSharing, style: const TextStyle(color: Brand.red)),
          ),
      ],
    );
  }
}

class _NextTripCard extends StatelessWidget {
  const _NextTripCard({required this.trip, required this.busy, required this.onAct});
  final DriverTrip trip;
  final bool busy;
  final void Function(String action) onAct;

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    final theme = Theme.of(context);
    final step = switch (trip.status) {
      'en_route' => 1,
      'arrived' => 2,
      'on_board' => 3,
      _ => 0,
    };
    final (label, action, color) = switch (trip.status) {
      'scheduled' => (t.start, 'start', Brand.route),
      'en_route' => (t.arrived, 'arrive', Brand.route),
      'arrived' => (t.pickedUp, 'pickup', Brand.route),
      _ => (t.complete, 'complete', Brand.ink),
    };
    final canNoShow = trip.status == 'arrived' &&
        trip.arrivedAt != null &&
        DateTime.now().difference(trip.arrivedAt!).inMinutes >= 5;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: trip.active ? Brand.route : Brand.line, width: trip.active ? 2 : 1),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(trip.active ? t.now : t.next, style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(trip.riderName ?? trip.riderPhone, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              _Clock(time: trip.scheduledAt),
            ],
          ),
          const SizedBox(height: 16),
          _Stops(trip: trip),
          const SizedBox(height: 16),
          _Steps(step: step),
          const SizedBox(height: 18),
          SizedBox(
            height: 60,
            child: FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: color,
                textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              onPressed: busy ? null : () => onAct(action),
              child: busy ? const ButtonSpinner() : Text(label),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => launchUrl(Uri.parse('tel:${trip.riderPhone}')),
                  icon: const Icon(Icons.call),
                  label: Text(t.call),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => launchUrl(
                    Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${trip.target.lat},${trip.target.lng}&travelmode=driving'),
                    mode: LaunchMode.externalApplication,
                  ),
                  icon: const Icon(Icons.navigation_outlined),
                  label: Text(t.navigate),
                ),
              ),
            ],
          ),
          if (trip.status == 'arrived')
            TextButton(
              onPressed: canNoShow && !busy ? () => _confirmNoShow(context) : null,
              style: TextButton.styleFrom(foregroundColor: Brand.red),
              child: Text(canNoShow ? t.noShow : t.noShowWait),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmNoShow(BuildContext context) async {
    final t = TripStrings.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t.noShow),
        content: Text(t.noShowConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.back)),
          TextButton(onPressed: () => Navigator.pop(c, true), style: TextButton.styleFrom(foregroundColor: Brand.red), child: Text(t.noShow)),
        ],
      ),
    );
    if (ok == true) onAct('no-show');
  }
}

class _Clock extends StatelessWidget {
  const _Clock({required this.time});
  final DateTime time;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(color: Brand.ink, borderRadius: BorderRadius.circular(8)),
      child: Text(
        DateFormat.Hm('en').format(time.toLocal()),
        textDirection: TextDirection.ltr,
        style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()]),
      ),
    );
  }
}

/// From and to, joined by the brand's route line.
class _Stops extends StatelessWidget {
  const _Stops({required this.trip});
  final DriverTrip trip;

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    final onBoard = trip.status == 'on_board';
    Widget stop(String label, String name, {required bool filled, required bool current}) => Row(
          children: [
            Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: filled ? Brand.route : Colors.white,
                border: Border.all(color: Brand.route, width: 3),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(color: Brand.inkSoft, fontSize: 12)),
                Text(name, style: TextStyle(fontSize: 16, fontWeight: current ? FontWeight.w700 : FontWeight.w500, color: Brand.ink)),
              ]),
            ),
          ],
        );
    return Column(
      children: [
        stop(t.pickup, trip.pickup.name, filled: false, current: !onBoard),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: Container(margin: const EdgeInsetsDirectional.only(start: 6), width: 2, height: 18, color: Brand.routeBright),
        ),
        stop(t.dropoff, trip.dropoff.name, filled: true, current: onBoard),
      ],
    );
  }
}

class _Steps extends StatelessWidget {
  const _Steps({required this.step});
  final int step;

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    final labels = [t.stepStart, t.stepArrive, t.stepBoard, t.stepDrop];
    return Row(
      children: [
        for (var i = 0; i < labels.length; i++)
          Expanded(
            child: Column(children: [
              Container(height: 4, margin: const EdgeInsets.symmetric(horizontal: 2), color: i < step ? Brand.route : (i == step ? Brand.routeBright : Brand.line)),
              const SizedBox(height: 6),
              Text(labels[i], style: TextStyle(fontSize: 11, color: i <= step ? Brand.ink : Brand.inkSoft)),
            ]),
          ),
      ],
    );
  }
}

class _TripRow extends StatelessWidget {
  const _TripRow({required this.trip});
  final DriverTrip trip;

  @override
  Widget build(BuildContext context) {
    final t = TripStrings.of(context);
    final finished = !trip.open;
    return Opacity(
      opacity: finished ? 0.6 : 1,
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Text(
          DateFormat.Hm('en').format(trip.scheduledAt.toLocal()),
          textDirection: TextDirection.ltr,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()]),
        ),
        title: Text(trip.riderName ?? trip.riderPhone),
        subtitle: Text('${trip.pickup.name} ${t.arrow} ${trip.dropoff.name}'),
        trailing: Text(t.status(trip.status), style: TextStyle(color: finished ? Brand.inkSoft : Brand.route, fontSize: 13)),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(children: [
          const RouteMark(),
          const SizedBox(height: 16),
          Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
        ]),
      );
}

class TripStrings {
  const TripStrings(this.ar);
  final bool ar;
  static TripStrings of(BuildContext context) => TripStrings(Localizations.localeOf(context).languageCode != 'en');
  String _t(String a, String e) => ar ? a : e;

  String get today => _t('رحلات اليوم', 'Today');
  String get account => _t('حسابي', 'My account');
  String progress(int done, int total) => _t('أنجزت $done من $total رحلة', '$done of $total trips done');
  String get sharing => _t('موقعك ظاهر للركاب', 'Sharing location');
  String get notSharing => _t('فعّل الموقع', 'Turn on location');
  String get noTrips => _t('لا توجد رحلات لك اليوم.', 'No trips for you today.');
  String get allDone => _t('أنهيت رحلات اليوم. شكرا لك.', 'All of today\'s trips are done. Thank you.');
  String get restOfDay => _t('بقية اليوم', 'Rest of the day');
  String get now => _t('الرحلة الحالية', 'Current trip');
  String get next => _t('الرحلة التالية', 'Next trip');
  String get pickup => _t('الركوب', 'Pick-up');
  String get dropoff => _t('الوصول', 'Drop-off');
  String get start => _t('ابدأ التحرك إلى الراكب', 'Start driving to the rider');
  String get arrived => _t('وصلت', 'I have arrived');
  String get pickedUp => _t('ركب الراكب', 'Rider is on board');
  String get complete => _t('أنهيت الرحلة', 'Trip complete');
  String get call => _t('اتصال', 'Call');
  String get navigate => _t('الملاحة', 'Navigate');
  String get noShow => _t('الراكب لم يحضر', 'Rider did not come');
  String get noShowWait => _t('يمكن تسجيل عدم الحضور بعد 5 دقائق من وصولك', 'You can record a no-show 5 minutes after arriving');
  String get noShowConfirm => _t('سنبلغ الراكب والشريك أنك انتظرت ولم يحضر.', 'We will tell the rider and the operator that you waited and they did not come.');
  String get back => _t('رجوع', 'Back');
  String get stepStart => _t('في الطريق', 'On the way');
  String get stepArrive => _t('وصلت', 'Arrived');
  String get stepBoard => _t('ركب', 'On board');
  String get stepDrop => _t('وصل', 'Dropped off');
  String get arrow => ar ? '←' : '→';
  String status(String s) => switch (s) {
        'scheduled' => _t('مجدولة', 'Scheduled'),
        'en_route' => _t('في الطريق', 'On the way'),
        'arrived' => _t('وصلت', 'Arrived'),
        'on_board' => _t('الراكب معك', 'On board'),
        'completed' => _t('مكتملة', 'Done'),
        'no_show' => _t('لم يحضر', 'No-show'),
        'skipped' => _t('ألغاها الراكب', 'Cancelled by rider'),
        _ => _t('ملغاة', 'Cancelled'),
      };
}
