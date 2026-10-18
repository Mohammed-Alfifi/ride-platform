import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_core/mobile_core.dart';

import 'subscriptions/billing_screen.dart';
import 'subscriptions/models.dart';
import 'subscriptions/new_subscription_screen.dart';
import 'subscriptions/repository.dart';
import 'subscriptions/strings.dart';
import 'subscriptions/subscription_screen.dart';
import 'subscriptions/trip_widgets.dart';

/// Home: the rider's subscriptions, or an invitation to start one. Asks for a name on first
/// sign-in, since the name goes on invoices and is what the driver sees.
class RiderHomeScreen extends ConsumerWidget {
  const RiderHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).valueOrNull;
    final t = RiderStrings.of(context);
    if (user == null) return const SizedBox.shrink();
    final subs = ref.watch(subscriptionsProvider);
    final visible = subs.valueOrNull?.where((s) => s.status != 'cancelled' && s.status != 'expired').toList() ?? const [];

    void openNew() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NewSubscriptionScreen()));

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 72,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(t.greeting, style: Theme.of(context).textTheme.bodyMedium),
            Text(user.needsName ? t.welcome : user.name!, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 24)),
          ],
        ),
        actions: [
          const NotificationsBell(),
          IconButton(
            tooltip: t.help,
            icon: const Icon(Icons.support_agent_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SupportScreen())),
          ),
          IconButton(
            tooltip: t.invoicesAndCards,
            icon: const Icon(Icons.receipt_long_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const BillingScreen())),
          ),
          IconButton(
            tooltip: Strings.of(context).profile,
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      floatingActionButton: visible.isEmpty
          ? null
          : FloatingActionButton.extended(onPressed: openNew, icon: const Icon(Icons.add), label: Text(t.addSubscription)),
      body: RefreshIndicator(
        onRefresh: () {
          ref.invalidate(tripsProvider);
          return ref.refresh(subscriptionsProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (user.needsName) const _NameCard(),
            const SizedBox(height: 8),
            const NextTripCard(),
            if (subs.isLoading && !subs.hasValue) const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
            if (subs.hasError && !subs.hasValue)
              Text(describeError(context, subs.error!), textAlign: TextAlign.center),
            if (subs.hasValue && visible.isEmpty)
              _EmptyState(
                title: t.noSubscriptionTitle,
                body: t.noSubscriptionBody,
                action: FilledButton(onPressed: openNew, child: Text(t.startSubscription)),
              ),
            for (final s in visible) _SubscriptionCard(sub: s),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({required this.sub});
  final Subscription sub;

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    final theme = Theme.of(context);
    final attention = sub.needsPayment;
    final tone = switch (sub.status) {
      'active' => 'ok',
      'pending_payment' || 'past_due' => 'wait',
      _ => 'bad',
    };
    Widget stop(String name, String? time, {required bool filled}) => Row(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: filled ? Brand.route : Colors.white,
                border: Border.all(color: Brand.route, width: 3),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(name, style: theme.textTheme.bodyLarge?.copyWith(fontSize: 15))),
            if (time != null)
              Text(time, textDirection: TextDirection.ltr, style: theme.textTheme.titleMedium?.copyWith(fontFamily: theme.textTheme.titleLarge?.fontFamily)),
          ],
        );

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: attention ? Brand.amber : Brand.line, width: attention ? 1.5 : 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SubscriptionScreen(id: sub.id))),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(t.ar ? sub.planNameAr : sub.planNameEn, style: theme.textTheme.titleMedium?.copyWith(fontSize: 17))),
                    StatusPill(label: t.status(sub.status), tone: tone),
                  ],
                ),
                if (sub.memberName != null || sub.driverName != null) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 14,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (sub.memberName != null)
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.person_outline, size: 16, color: Brand.inkSoft),
                          const SizedBox(width: 4),
                          Text(sub.memberName!, style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
                        ]),
                      if (sub.driverName != null)
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.directions_car_outlined, size: 16, color: Brand.inkSoft),
                          const SizedBox(width: 4),
                          Text(sub.driverName!, style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
                          if (sub.driverPlate != null) ...[const SizedBox(width: 6), PlateChip(sub.driverPlate!)],
                        ]),
                    ],
                  ),
                ],
                const SizedBox(height: 14),
                stop(sub.pickup.name, sub.outboundTime, filled: false),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Container(margin: const EdgeInsetsDirectional.only(start: 5), width: 2, height: 16, color: Brand.routeBright),
                ),
                stop(sub.dropoff.name, sub.returnTime, filled: true),
                const SizedBox(height: 16),
                Row(
                  children: [
                    for (var d = 0; d < 7; d++)
                      Expanded(
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          decoration: BoxDecoration(
                            color: sub.days.contains(d) ? Brand.route : Brand.surface,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            t.weekDays[d],
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.fade,
                            style: TextStyle(fontSize: 11, color: sub.days.contains(d) ? Colors.white : Brand.inkSoft, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                  ],
                ),
                if (sub.currentPeriodEnd != null && sub.live) ...[
                  const SizedBox(height: 14),
                  Text(
                    [
                      sub.cancelAtPeriodEnd ? t.endsOn(t.day(sub.currentPeriodEnd!)) : t.paidUntil(t.day(sub.currentPeriodEnd!)),
                      if (sub.card != null) '${sub.card!.brand} •••• ${sub.card!.last4}',
                    ].join(' · '),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
                if (attention) ...[
                  const SizedBox(height: 12),
                  Text(sub.status == 'past_due' ? t.pastDueBody : t.pendingBody, style: const TextStyle(color: Brand.sunDeep, fontWeight: FontWeight.w600)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NameCard extends ConsumerStatefulWidget {
  const _NameCard();

  @override
  ConsumerState<_NameCard> createState() => _NameCardState();
}

class _NameCardState extends ConsumerState<_NameCard> {
  final _controller = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _controller.text.trim();
    if (name.length < 2) return;
    setState(() => _saving = true);
    try {
      await ref.read(sessionProvider.notifier).updateName(name);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Brand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _controller,
            decoration: InputDecoration(labelText: s.name, helperText: s.nameHint),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: _saving ? null : _save, child: Text(s.save)),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, required this.body, this.action});
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Column(
        children: [
          const RouteMark(),
          const SizedBox(height: 20),
          Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(body, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
          if (action != null) ...[const SizedBox(height: 24), action!],
        ],
      ),
    );
  }
}
