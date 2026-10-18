import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:mobile_core/mobile_core.dart';

import 'checkout_screen.dart';
import 'models.dart';
import 'place_picker_screen.dart';
import 'repository.dart';
import 'strings.dart';
import 'subscription_screen.dart';

/// One screen, filled top to bottom: from and to, plan, days and times, then review and pay.
/// Each section appears once the one above it is complete.
class NewSubscriptionScreen extends ConsumerStatefulWidget {
  const NewSubscriptionScreen({super.key});

  @override
  ConsumerState<NewSubscriptionScreen> createState() => _NewSubscriptionScreenState();
}

class _NewSubscriptionScreenState extends ConsumerState<NewSubscriptionScreen> {
  Place? _pickup;
  Place? _dropoff;
  List<Coverage>? _coverage;
  bool _loadingCoverage = false;
  Plan? _plan;
  Quote? _quote;
  bool _loadingQuote = false;
  final Set<int> _days = {};
  TimeOfDay _outbound = const TimeOfDay(hour: 6, minute: 30);
  TimeOfDay _return = const TimeOfDay(hour: 13, minute: 30);
  bool _saveCard = true;
  bool _paying = false;
  /// null = the account holder rides.
  FamilyMember? _member;
  final _promo = TextEditingController();
  String? _promoError;

  @override
  void dispose() {
    _promo.dispose();
    super.dispose();
  }

  RepoErrors get _repo => RepoErrors(ref.read(riderRepositoryProvider));

  Future<void> _choosePlace({required bool pickup}) async {
    final t = RiderStrings.of(context);
    final places = await ref.read(placesProvider.future).catchError((_) => <Place>[]);
    if (!mounted) return;
    final chosen = await showModalBottomSheet<Object>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final p in places)
              ListTile(
                leading: Icon(_iconFor(p.label)),
                title: Text(p.name),
                subtitle: Text(t.placeLabel(p.label)),
                onTap: () => Navigator.of(context).pop(p),
              ),
            ListTile(
              leading: const Icon(Icons.add_location_alt_outlined, color: Brand.route),
              title: Text(t.addPlace, style: const TextStyle(color: Brand.route, fontWeight: FontWeight.w600)),
              onTap: () => Navigator.of(context).pop('add'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || chosen == null) return;
    Place? place = chosen is Place ? chosen : null;
    if (chosen == 'add') {
      final near = _pickup ?? _dropoff;
      place = await Navigator.of(context).push<Place>(MaterialPageRoute(
        builder: (_) => PlacePickerScreen(
          initialLabel: pickup ? 'home' : 'school',
          center: near == null ? null : LatLng(near.lat, near.lng),
        ),
      ));
    }
    if (place == null) return;
    setState(() {
      if (pickup) {
        _pickup = place;
        _coverage = null;
      } else {
        _dropoff = place;
      }
      _plan = null;
      _quote = null;
    });
    if (pickup) await _loadCoverage();
    if (_pickup != null && _dropoff != null && _plan != null) await _loadQuote();
  }

  Future<void> _loadCoverage() async {
    final at = _pickup;
    if (at == null) return;
    setState(() => _loadingCoverage = true);
    final result = await _repo.run(context, () => ref.read(riderRepositoryProvider).coverage(at));
    if (!mounted) return;
    setState(() {
      _coverage = result ?? const [];
      _loadingCoverage = false;
      final plans = _allPlans;
      if (plans.length == 1) _plan = plans.single;
    });
    if (_plan != null) await _loadQuote();
  }

  List<Plan> get _allPlans => [for (final c in _coverage ?? const <Coverage>[]) ...c.plans];

  Future<void> _selectPlan(Plan plan) async {
    setState(() {
      _plan = plan;
      _quote = null;
      if (_days.length > plan.daysPerWeek) _days.clear();
    });
    await _loadQuote();
  }

  Future<void> _loadQuote() async {
    final plan = _plan, pickup = _pickup, dropoff = _dropoff;
    if (plan == null || pickup == null || dropoff == null || pickup.id == dropoff.id) return;
    setState(() => _loadingQuote = true);
    final q = await _repo.run(
      context,
      () => ref.read(riderRepositoryProvider).quote(planId: plan.id, pickupId: pickup.id, dropoffId: dropoff.id),
    );
    // Keep a code already applied, if it still works with this plan.
    if (q != null && _quote?.promoCode != null) {
      final withCode = await _tryPromo(plan, pickup, dropoff, _quote!.promoCode!);
      if (withCode != null && mounted) {
        setState(() {
          _quote = withCode;
          _loadingQuote = false;
        });
        return;
      }
    }
    if (mounted) {
      setState(() {
        _quote = q;
        _loadingQuote = false;
      });
    }
  }

  Future<Quote?> _tryPromo(Plan plan, Place pickup, Place dropoff, String code) async {
    try {
      return await ref.read(riderRepositoryProvider).quote(planId: plan.id, pickupId: pickup.id, dropoffId: dropoff.id, promoCode: code);
    } catch (e) {
      if (mounted) setState(() => _promoError = describeError(context, e));
      return null;
    }
  }

  Future<void> _applyPromo() async {
    final code = _promo.text.trim();
    if (code.isEmpty || _plan == null) return;
    setState(() => _promoError = null);
    final q = await _tryPromo(_plan!, _pickup!, _dropoff!, code);
    if (q != null && mounted) setState(() => _quote = q);
  }

  Future<void> _chooseRider() async {
    final t = RiderStrings.of(context);
    final family = await ref.read(familyProvider.future).catchError((_) => <FamilyMember>[]);
    if (!mounted) return;
    final picked = await showModalBottomSheet<Object>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          ListTile(leading: const Icon(Icons.person_outline), title: Text(t.me), onTap: () => Navigator.pop(c, 'me')),
          for (final m in family)
            ListTile(
              leading: const Icon(Icons.child_care_outlined),
              title: Text(m.name),
              subtitle: m.note == null ? null : Text(m.note!),
              onTap: () => Navigator.pop(c, m),
            ),
          ListTile(
            leading: const Icon(Icons.person_add_alt_1_outlined, color: Brand.route),
            title: Text(t.addFamily, style: const TextStyle(color: Brand.route, fontWeight: FontWeight.w600)),
            onTap: () => Navigator.pop(c, 'add'),
          ),
        ]),
      ),
    );
    if (!mounted || picked == null) return;
    if (picked == 'me') {
      setState(() => _member = null);
      return;
    }
    if (picked is FamilyMember) {
      setState(() => _member = picked);
      return;
    }
    final added = await showDialog<FamilyMember>(context: context, builder: (_) => const AddMemberDialog());
    if (added != null && mounted) {
      ref.invalidate(familyProvider);
      setState(() => _member = added);
    }
  }

  String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  int _minutes(TimeOfDay t) => t.hour * 60 + t.minute;

  String? _scheduleProblem(RiderStrings t) {
    final out = _minutes(_outbound);
    if (out < 5 * 60 || out > 22 * 60) return t.serviceHours;
    if (_plan!.roundTrip && _minutes(_return) <= out) return t.returnAfterOutbound;
    return null;
  }

  bool get _ready =>
      _plan != null && _quote?.eligible == true && _days.length == _plan!.daysPerWeek && _scheduleProblem(RiderStrings.of(context)) == null;

  Future<void> _pay() async {
    final plan = _plan!;
    setState(() => _paying = true);
    final repo = ref.read(riderRepositoryProvider);
    final created = await _repo.run(
      context,
      () => repo.subscribe(
        planId: plan.id,
        pickupId: _pickup!.id,
        dropoffId: _dropoff!.id,
        days: _days.toList()..sort(),
        outboundTime: _hhmm(_outbound),
        returnTime: plan.roundTrip ? _hhmm(_return) : null,
        saveCard: _saveCard,
        memberId: _member?.id,
        promoCode: _quote?.promoCode,
      ),
    );
    if (!mounted) return;
    setState(() => _paying = false);
    if (created == null) return;
    final (sub, payment) = created;
    ref.invalidate(subscriptionsProvider);
    final result = payment.checkoutUrl == null
        ? payment
        : await CheckoutScreen.open(context, paymentId: payment.id, checkoutUrl: payment.checkoutUrl!);
    if (!mounted) return;
    ref.invalidate(subscriptionsProvider);
    showPaymentOutcome(context, result);
    // Land on the subscription either way: active, or waiting for payment with a "Pay now" button.
    await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => SubscriptionScreen(id: sub.id)));
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    final theme = Theme.of(context);
    final samePlace = _pickup != null && _dropoff != null && _pickup!.id == _dropoff!.id;
    final routeDone = _pickup != null && _dropoff != null && !samePlace;

    return Scaffold(
      appBar: AppBar(title: Text(t.addSubscription)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          _SectionTitle(t.whoRides),
          Material(
            color: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Brand.line)),
            child: ListTile(
              leading: Icon(_member == null ? Icons.person_outline : Icons.child_care_outlined, color: Brand.route),
              title: Text(_member?.name ?? t.me, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(_member == null ? t.whoRidesHint : (_member!.note ?? t.relation(_member!.relation))),
              trailing: const Icon(Icons.expand_more),
              onTap: _chooseRider,
            ),
          ),
          _SectionTitle(t.stepRoute),
          _PlaceField(label: t.pickup, place: _pickup, icon: Icons.trip_origin, onTap: () => _choosePlace(pickup: true)),
          const SizedBox(height: 8),
          _PlaceField(label: t.dropoff, place: _dropoff, icon: Icons.place, onTap: () => _choosePlace(pickup: false)),
          if (samePlace) _Notice(t.samePlace),
          if (_pickup != null) ...[
            _SectionTitle(t.stepPlan),
            if (_loadingCoverage) const _Loading(),
            if (_coverage != null && _allPlans.isEmpty) _Notice(t.noCoverage),
            for (final c in _coverage ?? const <Coverage>[])
              for (final p in c.plans)
                _PlanTile(
                  plan: p,
                  partner: c.partner(t.ar),
                  selected: _plan?.id == p.id,
                  onTap: () => _selectPlan(p),
                ),
            if (_loadingQuote) const _Loading(),
            if (_quote != null && !_quote!.eligible)
              _Notice(_quote!.reason == 'PLAN_DISTANCE_EXCEEDED'
                  ? t.distanceTooFar(_quote!.distanceKm, _quote!.maxDistanceKm)
                  : t.outsideZone),
          ],
          if (routeDone && _plan != null && _quote?.eligible == true) ...[
            _SectionTitle(t.stepSchedule),
            Text(t.chooseDays(_plan!.daysPerWeek), style: theme.textTheme.bodyMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var d = 0; d < 7; d++)
                  FilterChip(
                    label: Text(t.weekDays[d]),
                    selected: _days.contains(d),
                    onSelected: (on) => setState(() {
                      if (!on) {
                        _days.remove(d);
                      } else if (_days.length < _plan!.daysPerWeek) {
                        _days.add(d);
                      }
                    }),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: _TimeField(label: t.outboundTime, value: _outbound, onChanged: (v) => setState(() => _outbound = v))),
                if (_plan!.roundTrip) ...[
                  const SizedBox(width: 12),
                  Expanded(child: _TimeField(label: t.returnTime, value: _return, onChanged: (v) => setState(() => _return = v))),
                ],
              ],
            ),
            if (_scheduleProblem(t) != null) _Notice(_scheduleProblem(t)!),
          ],
          if (_ready) ...[
            _SectionTitle(t.stepReview),
            RouteMap(from: _pickup!, to: _dropoff!),
            const SizedBox(height: 12),
            _Line(t.distance, t.km(_quote!.distanceKm)),
            _Line(t.schedule, t.daysList(_days.toList()..sort())),
            const Divider(height: 24),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(child: Text(t.monthlyTotal, style: theme.textTheme.titleMedium)),
                Text(t.perMonth(t.sar(_quote!.priceHalalas)), style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 4),
            Text(t.vatIncluded(t.sar(_quote!.vatHalalas)), style: theme.textTheme.bodySmall),
            const SizedBox(height: 16),
            if (_quote!.promoCode == null)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _promo,
                      textCapitalization: TextCapitalization.characters,
                      textDirection: TextDirection.ltr,
                      decoration: InputDecoration(labelText: t.promoCode, errorText: _promoError),
                      onSubmitted: (_) => _applyPromo(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(height: 56, child: OutlinedButton(onPressed: _applyPromo, child: Text(t.apply))),
                ],
              )
            else
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Brand.sunTint, borderRadius: BorderRadius.circular(14)),
                child: Row(children: [
                  const Icon(Icons.local_offer_outlined, color: Brand.sunDeep),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(t.promoApplied(_quote!.promoCode!, t.sar(_quote!.discountHalalas)),
                        style: const TextStyle(color: Brand.sunDeep, fontWeight: FontWeight.w600)),
                  ),
                ]),
              ),
            const SizedBox(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _saveCard,
              onChanged: (v) => setState(() => _saveCard = v),
              title: Text(t.saveCard),
              subtitle: Text(t.saveCardHint),
            ),
            const SizedBox(height: 8),
            Text(t.startsTomorrow, style: theme.textTheme.bodySmall),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _paying ? null : _pay,
              child: _paying ? const ButtonSpinner() : Text(t.payAmount(t.sar(_quote!.firstPaymentHalalas))),
            ),
            const SizedBox(height: 8),
            Text(t.payWith, textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

/// Runs a call and shows the server's message in a snackbar when it fails.
class RepoErrors {
  RepoErrors(this.repo);
  final RiderRepository repo;

  Future<T?> run<T>(BuildContext context, Future<T> Function() call) async {
    try {
      return await call();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
      return null;
    }
  }
}

void showPaymentOutcome(BuildContext context, Payment? p) {
  if (p == null) return;
  final t = RiderStrings.of(context);
  final text = switch (p.status) {
    'paid' => t.paid,
    'failed' => t.paymentFailed,
    _ => t.paymentPending,
  };
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(text),
    backgroundColor: p.status == 'paid' ? Brand.route : (p.status == 'failed' ? Brand.red : null),
  ));
}

IconData _iconFor(String label) => switch (label) {
      'home' => Icons.home_outlined,
      'school' => Icons.school_outlined,
      'work' => Icons.work_outline,
      _ => Icons.place_outlined,
    };

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 24, bottom: 10),
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      );
}

class _PlaceField extends StatelessWidget {
  const _PlaceField({required this.label, required this.place, required this.icon, required this.onTap});
  final String label;
  final Place? place;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Brand.line)),
      child: ListTile(
        leading: Icon(icon, color: Brand.route),
        title: Text(label, style: Theme.of(context).textTheme.bodySmall),
        subtitle: Text(
          place?.name ?? t.choosePlace,
          style: TextStyle(color: place == null ? Brand.inkSoft : Brand.ink, fontSize: 16, fontWeight: FontWeight.w500),
        ),
        trailing: const Icon(Icons.expand_more),
        onTap: onTap,
      ),
    );
  }
}

class _PlanTile extends StatelessWidget {
  const _PlanTile({required this.plan, required this.partner, required this.selected, required this.onTap});
  final Plan plan;
  final String partner;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: selected ? const Color(0xFFE7F3EE) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: selected ? Brand.route : Brand.line, width: selected ? 2 : 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(plan.name(t.ar), style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text(
                        '${plan.roundTrip ? t.roundTrip : t.oneWay} · ${t.daysPerWeek(plan.daysPerWeek)} · ${t.upToKm(plan.maxDistanceKm)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      Text(partner, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                Text(t.perMonth(t.sar(plan.priceHalalas)), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.ink)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({required this.label, required this.value, required this.onChanged});
  final String label;
  final TimeOfDay value;
  final ValueChanged<TimeOfDay> onChanged;

  @override
  Widget build(BuildContext context) {
    final text = '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
    return InkWell(
      onTap: () async {
        final picked = await showTimePicker(context: context, initialTime: value);
        if (picked != null) onChanged(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.schedule)),
        child: Text(text, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 16, fontFeatures: [FontFeature.tabularFigures()])),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 130, child: Text(label, style: Theme.of(context).textTheme.bodyMedium)),
            Expanded(child: Text(value, style: Theme.of(context).textTheme.bodyLarge)),
          ],
        ),
      );
}

class _Notice extends StatelessWidget {
  const _Notice(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF6E5),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFFF0D9A8)),
        ),
        child: Text(text, style: const TextStyle(color: Brand.ink, height: 1.5)),
      );
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) =>
      const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
}

/// Adds a child or relative the account holder books rides for.
class AddMemberDialog extends ConsumerStatefulWidget {
  const AddMemberDialog({super.key});

  @override
  ConsumerState<AddMemberDialog> createState() => _AddMemberDialogState();
}

class _AddMemberDialogState extends ConsumerState<AddMemberDialog> {
  final _name = TextEditingController();
  final _note = TextEditingController();
  String _relation = 'child';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().length < 2) return;
    setState(() => _busy = true);
    final m = await RepoErrors(ref.read(riderRepositoryProvider)).run(
      context,
      () => ref.read(riderRepositoryProvider).addMember(name: _name.text.trim(), relation: _relation, note: _note.text.trim()),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (m != null) Navigator.of(context).pop(m);
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return AlertDialog(
      title: Text(t.addFamily),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: _name, autofocus: true, decoration: InputDecoration(labelText: t.memberName)),
        const SizedBox(height: 12),
        Wrap(spacing: 8, children: [
          for (final r in const ['child', 'spouse', 'parent', 'other'])
            ChoiceChip(label: Text(t.relation(r)), selected: _relation == r, onSelected: (_) => setState(() => _relation = r)),
        ]),
        const SizedBox(height: 12),
        TextField(controller: _note, decoration: InputDecoration(labelText: t.memberNote, hintText: t.memberNoteHint)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.back)),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(96, 44)),
          onPressed: _busy ? null : _save,
          child: Text(t.confirm),
        ),
      ],
    );
  }
}
