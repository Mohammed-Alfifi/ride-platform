import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'details_screen.dart';
import 'document_screen.dart';
import 'models.dart';
import 'onboarding_controller.dart';
import 'strings.dart';
import 'vehicle_screen.dart';

/// The checklist a new driver works through: partner, details, vehicle, documents, submit.
class OnboardingView extends ConsumerWidget {
  const OnboardingView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(onboardingProvider);
    final t = OnboardingStrings.of(context);
    return state.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(padding: const EdgeInsets.all(24), child: Text(describeError(context, e), textAlign: TextAlign.center)),
            OutlinedButton(
              onPressed: () => ref.read(onboardingProvider.notifier).refresh(),
              child: Text(Strings.of(context).retry),
            ),
          ],
        ),
      ),
      data: (o) => RefreshIndicator(
        onRefresh: () => ref.read(onboardingProvider.notifier).refresh(),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            _Banner(onboarding: o),
            if (o.status == 'not_joined') const _JoinCard() else _PartnerRow(onboarding: o),
            if (o.status != 'not_joined') ...[
              const SizedBox(height: 12),
              _StepTile(
                title: t.stepDetails,
                done: o.details?.complete ?? false,
                subtitle: o.details?.fullName,
                enabled: o.editable,
                onTap: () => _open(context, const DetailsScreen()),
              ),
              _StepTile(
                title: t.stepVehicle,
                done: o.vehicle != null,
                subtitle: o.vehicle == null
                    ? null
                    : '${o.vehicle!.make} ${o.vehicle!.model} ${o.vehicle!.year} · ${o.vehicle!.plateLetters} ${o.vehicle!.plateNumbers}',
                enabled: o.editable,
                onTap: () => _open(context, const VehicleScreen()),
              ),
              const SizedBox(height: 20),
              Text(t.stepDocuments, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final type in documentTypes) _DocumentTile(type: type, document: o.document(type)),
              if (o.editable) ...[
                const SizedBox(height: 24),
                _SubmitButton(enabled: o.canSubmit),
              ],
            ],
          ],
        ),
      ),
    );
  }

  static void _open(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.onboarding});
  final Onboarding onboarding;

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    final (Color color, String title, String? body) = switch (onboarding) {
      Onboarding(complianceHold: true) => (Brand.red, t.holdTitle, t.holdBody),
      Onboarding(status: 'submitted') => (Brand.amber, t.submitted, t.submittedBody),
      Onboarding(status: 'rejected') => (Brand.red, t.rejectedTitle, onboarding.rejectionReason),
      Onboarding(status: 'approved') => (Brand.route, t.approvedTitle, t.approvedBody),
      _ => (Brand.ink, '', null),
    };
    if (title.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            border: BorderDirectional(start: BorderSide(color: color, width: 4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: color)),
              if (body != null) ...[
                const SizedBox(height: 6),
                Text(body, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _JoinCard extends ConsumerStatefulWidget {
  const _JoinCard();

  @override
  ConsumerState<_JoinCard> createState() => _JoinCardState();
}

class _JoinCardState extends ConsumerState<_JoinCard> {
  final _code = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _join() async {
    if (_code.text.trim().length < 4) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(onboardingProvider.notifier).join(_code.text);
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(t.joinTitle, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(t.joinBody, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 16),
        TextField(
          controller: _code,
          textCapitalization: TextCapitalization.characters,
          textDirection: TextDirection.ltr,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 22, letterSpacing: 6, fontWeight: FontWeight.w600),
          decoration: InputDecoration(labelText: t.joinCode, errorText: _error, errorMaxLines: 3),
          onSubmitted: (_) => _join(),
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: _busy ? null : _join, child: _busy ? const ButtonSpinner() : Text(t.join)),
      ],
    );
  }
}

class _PartnerRow extends StatelessWidget {
  const _PartnerRow({required this.onboarding});
  final Onboarding onboarding;

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    final p = onboarding.partner!;
    final name = t.ar ? p.nameAr : p.nameEn;
    return Row(
      children: [
        const Icon(Icons.business_outlined, size: 20, color: Brand.inkSoft),
        const SizedBox(width: 8),
        Expanded(child: Text(t.joinedTo(name), style: Theme.of(context).textTheme.bodyLarge)),
      ],
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.title, required this.done, required this.enabled, required this.onTap, this.subtitle});
  final String title;
  final bool done;
  final bool enabled;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Brand.line)),
      child: ListTile(
        leading: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? Brand.route : Brand.inkSoft),
        title: Text(title),
        subtitle: Text(subtitle ?? (done ? t.done : t.todo)),
        trailing: enabled ? const Icon(Icons.chevron_left_rounded, textDirection: TextDirection.ltr) : null,
        onTap: enabled ? onTap : null,
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({required this.type, required this.document});
  final String type;
  final DriverDocument? document;

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    final doc = document;
    final color = switch (doc?.status) {
      'accepted' => Brand.route,
      'pending' => Brand.amber,
      'rejected' => Brand.red,
      _ => Brand.inkSoft,
    };
    final lines = <String>[
      if (doc == null) t.todo else t.docStatus(doc.status),
      if (doc?.expiresAt != null) t.expires(doc!.expiresAt!),
      if (doc?.rejectionReason != null) doc!.rejectionReason!,
    ];
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Brand.line)),
      child: ListTile(
        leading: Icon(
          doc == null ? Icons.upload_file_outlined : (doc.status == 'rejected' ? Icons.error_outline : Icons.description_outlined),
          color: color,
        ),
        title: Text(t.docName(type)),
        subtitle: Text(lines.join('\n'), style: TextStyle(color: doc?.status == 'rejected' ? Brand.red : null)),
        isThreeLine: lines.length > 2,
        trailing: TextButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => DocumentScreen(type: type)),
          ),
          child: Text(doc == null ? t.upload : t.replace),
        ),
      ),
    );
  }
}

class _SubmitButton extends ConsumerStatefulWidget {
  const _SubmitButton({required this.enabled});
  final bool enabled;

  @override
  ConsumerState<_SubmitButton> createState() => _SubmitButtonState();
}

class _SubmitButtonState extends ConsumerState<_SubmitButton> {
  bool _busy = false;

  Future<void> _submit() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(onboardingProvider.notifier).submit();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    return FilledButton(
      onPressed: widget.enabled && !_busy ? _submit : null,
      child: _busy ? const ButtonSpinner() : Text(t.submit),
    );
  }
}
