import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:url_launcher/url_launcher.dart';

import 'checkout_screen.dart';
import 'models.dart';
import 'new_subscription_screen.dart' show RepoErrors, showPaymentOutcome;
import 'place_picker_screen.dart';
import 'repository.dart';
import 'strings.dart';
import 'trip_widgets.dart';

/// One subscription: where and when, what is paid, and the rider's controls
/// (pay, pause for a trip, resume, stop renewing, keep).
class SubscriptionScreen extends ConsumerWidget {
  const SubscriptionScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    final sub = ref.watch(subscriptionProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(sub.valueOrNull == null ? '' : (t.ar ? sub.value!.planNameAr : sub.value!.planNameEn))),
      body: sub.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(padding: const EdgeInsets.all(24), child: Text(describeError(context, e), textAlign: TextAlign.center)),
              OutlinedButton(onPressed: () => ref.invalidate(subscriptionProvider(id)), child: Text(Strings.of(context).retry)),
            ],
          ),
        ),
        data: (s) => RefreshIndicator(
          onRefresh: () => ref.refresh(subscriptionProvider(id).future),
          child: _Body(sub: s),
        ),
      ),
    );
  }
}

class _Body extends ConsumerStatefulWidget {
  const _Body({required this.sub});
  final Subscription sub;

  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  bool _busy = false;

  Subscription get s => widget.sub;

  Future<void> _act(Future<Object?> Function(RiderRepository repo) call) async {
    setState(() => _busy = true);
    await RepoErrors(ref.read(riderRepositoryProvider)).run(context, () => call(ref.read(riderRepositoryProvider)));
    ref.invalidate(subscriptionProvider(s.id));
    ref.invalidate(subscriptionsProvider);
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _pay() async {
    setState(() => _busy = true);
    final repo = ref.read(riderRepositoryProvider);
    // Reuse the open payment page if there is one; otherwise ask for a new one.
    final payment = s.payUrl != null && s.pendingPaymentId != null
        ? Payment(id: s.pendingPaymentId!, status: 'initiated', checkoutUrl: s.payUrl, failureReason: null, invoiceId: null)
        : await RepoErrors(repo).run(context, () => repo.payNow(s.id));
    if (!mounted) return;
    setState(() => _busy = false);
    if (payment?.checkoutUrl == null) return;
    final result = await CheckoutScreen.open(context, paymentId: payment!.id, checkoutUrl: payment.checkoutUrl!);
    if (!mounted) return;
    showPaymentOutcome(context, result);
    ref.invalidate(subscriptionProvider(s.id));
    ref.invalidate(subscriptionsProvider);
  }

  Future<void> _pause() async {
    final t = RiderStrings.of(context);
    final today = DateTime.parse('${riyadhToday()}T00:00:00');
    final end = DateTime.parse('${s.currentPeriodEnd!}T00:00:00');
    final range = await showDateRangePicker(
      context: context,
      firstDate: today.add(const Duration(days: 1)),
      lastDate: end.add(const Duration(days: 30)),
      helpText: t.pause,
      saveText: t.confirm,
    );
    if (range == null || !mounted) return;
    await _act((repo) => repo.pause(s.id, isoDay(range.start), isoDay(range.end)));
  }

  Future<void> _cancel() async {
    final t = RiderStrings.of(context);
    if (s.status == 'pending_payment') {
      await _act((repo) => repo.cancel(s.id));
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(t.cancelConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.back)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Brand.red),
            child: Text(t.cancel),
          ),
        ],
      ),
    );
    if (ok == true) await _act((repo) => repo.cancel(s.id));
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    final theme = Theme.of(context);
    final today = riyadhToday();
    final pauseOpen = s.pauseOpen(today);
    final pausedThisPeriod = s.pausedUntil != null && s.currentPeriodStart != null && s.pausedUntil!.compareTo(s.currentPeriodStart!) >= 0;

    String? periodLine;
    if (s.currentPeriodEnd != null && s.live) {
      final end = t.day(s.currentPeriodEnd!);
      periodLine = s.cancelAtPeriodEnd ? t.endsOn(end) : (s.autoRenew && s.card != null ? t.renewsOn(end) : t.paidUntil(end));
    }

    final config = ref.watch(serverConfigProvider).valueOrNull;
    final manual = config != null && config.manualPayments ? config : null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        Row(
          children: [
            _StatusPill(status: s.status),
            const Spacer(),
            Text(t.perMonth(t.sar(s.priceHalalas)), style: theme.textTheme.titleMedium),
          ],
        ),
        if (periodLine != null) ...[const SizedBox(height: 8), Text(periodLine, style: theme.textTheme.bodyLarge)],
        if (s.needsPayment && manual != null) ...[
          const SizedBox(height: 12),
          _ManualPay(sub: s, config: manual),
        ] else if (s.needsPayment) ...[
          const SizedBox(height: 12),
          _Callout(text: s.status == 'past_due' ? t.pastDueBody : t.pendingBody),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy ? null : _pay, child: Text(t.payNow)),
        ],
        if (pauseOpen) ...[
          const SizedBox(height: 12),
          _Callout(text: t.pausedRange(t.day(s.pausedFrom!), t.day(s.pausedUntil!)), tone: Brand.inkSoft),
        ],
        const SizedBox(height: 20),
        RouteMap(from: s.pickup, to: s.dropoff, height: 160),
        const SizedBox(height: 12),
        _Row(icon: Icons.trip_origin, title: s.pickup.name, subtitle: t.placeLabel(s.pickup.label)),
        _Row(icon: Icons.place, title: s.dropoff.name, subtitle: t.placeLabel(s.dropoff.label)),
        _Row(
          icon: Icons.calendar_today_outlined,
          title: t.daysList(s.days),
          subtitle: s.returnTime == null ? s.outboundTime : '${s.outboundTime}  ·  ${s.returnTime}',
        ),
        _Row(
          icon: Icons.credit_card,
          title: t.renewalCard,
          subtitle: s.card == null ? t.noCard : '${s.card!.brand} •••• ${s.card!.last4}',
        ),
        _Row(icon: Icons.apartment_outlined, title: t.serviceBy, subtitle: t.ar ? s.partnerNameAr : s.partnerNameEn),
        if (s.live) ...[const SizedBox(height: 16), UpcomingTrips(subscriptionId: s.id)],
        const SizedBox(height: 20),
        if (s.status == 'active' && !pauseOpen && !pausedThisPeriod) ...[
          OutlinedButton.icon(onPressed: _busy ? null : _pause, icon: const Icon(Icons.pause), label: Text(t.pause)),
          Padding(padding: const EdgeInsets.only(top: 6, bottom: 12), child: Text(t.pauseHelp, style: theme.textTheme.bodySmall)),
        ],
        if (pauseOpen)
          OutlinedButton.icon(
            onPressed: _busy ? null : () => _act((repo) => repo.resume(s.id)),
            icon: const Icon(Icons.play_arrow),
            label: Text(t.resume),
          ),
        if (s.cancelAtPeriodEnd && s.status == 'active')
          OutlinedButton(onPressed: _busy ? null : () => _act((repo) => repo.keep(s.id)), child: Text(t.keep)),
        if (!s.cancelAtPeriodEnd && (s.live || s.status == 'pending_payment'))
          TextButton(
            onPressed: _busy ? null : _cancel,
            style: TextButton.styleFrom(foregroundColor: Brand.red),
            child: Text(s.status == 'pending_payment' ? t.cancelPending : t.cancel),
          ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'active' => Brand.route,
      'pending_payment' || 'paused' => Brand.amber,
      _ => Brand.red,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(RiderStrings.of(context).status(status), style: TextStyle(color: color, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _Callout extends StatelessWidget {
  const _Callout({required this.text, this.tone = Brand.amber});
  final String text;
  final Color tone;

  @override
  // A one-sided border cannot be combined with rounded corners, so the corners come from a clip.
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            border: BorderDirectional(start: BorderSide(color: tone, width: 4)),
          ),
          child: Text(text, style: const TextStyle(color: Brand.ink, height: 1.5)),
        ),
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.title, required this.subtitle});
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon, color: Brand.inkSoft),
        title: Text(title),
        subtitle: Text(subtitle),
      );
}

/// Pilot without a payment gateway: how to pay the team, and a WhatsApp shortcut for the receipt.
class _ManualPay extends ConsumerWidget {
  const _ManualPay({required this.sub, required this.config});
  final Subscription sub;
  final ServerConfig config;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    final theme = Theme.of(context);
    final user = ref.watch(sessionProvider).valueOrNull;
    final amount = t.sar(sub.amountDueHalalas ?? sub.priceHalalas);
    final receipt = config.whatsapp(t.receiptMessage(
      user?.name ?? user?.phone ?? '',
      t.ar ? sub.planNameAr : sub.planNameEn,
      amount,
      sub.id.substring(0, 8).toUpperCase(),
    ));
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Brand.sunTint, borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            const Icon(Icons.account_balance_outlined, color: Brand.sunDeep),
            const SizedBox(width: 8),
            Expanded(child: Text(t.manualPayTitle, style: theme.textTheme.titleMedium)),
            Text(amount, style: theme.textTheme.titleMedium?.copyWith(color: Brand.sunDeep)),
          ]),
          const SizedBox(height: 10),
          SelectableText(config.paymentInstructions(t.ar), style: const TextStyle(height: 1.7)),
          const SizedBox(height: 10),
          Text(t.manualPending, style: theme.textTheme.bodySmall),
          if (receipt != null) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => launchUrl(receipt, mode: LaunchMode.externalApplication),
              icon: const Icon(Icons.chat_outlined),
              label: Text(t.sendReceipt),
            ),
          ],
        ],
      ),
    );
  }
}
