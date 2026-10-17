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
        title: Text(user.needsName ? t.welcome : t.hello(user.name!)),
        actions: [
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
        onRefresh: () => ref.refresh(subscriptionsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (user.needsName) const _NameCard(),
            const SizedBox(height: 8),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: attention ? Brand.amber : Brand.line),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SubscriptionScreen(id: sub.id))),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(t.ar ? sub.planNameAr : sub.planNameEn, style: theme.textTheme.titleMedium)),
                    Text(t.status(sub.status), style: TextStyle(color: attention ? Brand.amber : Brand.route, fontWeight: FontWeight.w600)),
                  ],
                ),
                const SizedBox(height: 10),
                Text('${sub.pickup.name}  ${t.ar ? '←' : '→'}  ${sub.dropoff.name}', style: theme.textTheme.bodyLarge),
                const SizedBox(height: 4),
                Text(
                  '${t.daysList(sub.days)}  ·  ${sub.outboundTime}${sub.returnTime == null ? '' : ' / ${sub.returnTime}'}',
                  style: theme.textTheme.bodyMedium,
                ),
                if (sub.currentPeriodEnd != null && sub.live) ...[
                  const SizedBox(height: 4),
                  Text(t.paidUntil(t.day(sub.currentPeriodEnd!)), style: theme.textTheme.bodySmall),
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
