import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../auth/session_controller.dart';
import '../l10n/strings.dart';
import '../notifications/inbox.dart';
import '../notifications/push.dart';
import '../ui/app_shell.dart';
import '../ui/theme.dart';
import 'server_config.dart';

/// Wraps each app's home once signed in: asks for the current terms when needed, and turns on
/// push notifications (shown as a banner when the app is open).
class SignedInGate extends ConsumerStatefulWidget {
  const SignedInGate({super.key, required this.child});
  final Widget child;

  @override
  ConsumerState<SignedInGate> createState() => _SignedInGateState();
}

class _SignedInGateState extends ConsumerState<SignedInGate> {
  StreamSubscription<Object>? _sub;

  @override
  void initState() {
    super.initState();
    final push = ref.read(pushServiceProvider);
    _sub = push.foreground.listen((n) {
      ref.invalidate(inboxProvider);
      rootMessengerKey.currentState?.showSnackBar(
        SnackBar(content: Text([n.title, n.body].whereType<String>().where((t) => t.isNotEmpty).join('\n'))),
      );
    });
    unawaited(push.register());
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).valueOrNull;
    final config = ref.watch(serverConfigProvider).valueOrNull;
    final needsTerms = user != null && config != null && config.termsVersion.isNotEmpty && user.termsVersion != config.termsVersion;
    return needsTerms ? TermsScreen(config: config) : widget.child;
  }
}

/// Shown on first sign-in and whenever the terms change.
class TermsScreen extends ConsumerStatefulWidget {
  const TermsScreen({super.key, required this.config});
  final ServerConfig config;

  @override
  ConsumerState<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends ConsumerState<TermsScreen> {
  bool _agreed = false;
  bool _busy = false;
  String? _error;

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).acceptTerms(widget.config.termsVersion);
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final theme = Theme.of(context);
    Widget link(String label, String url) => OutlinedButton.icon(
          onPressed: url.isEmpty ? null : () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
          icon: const Icon(Icons.open_in_new, size: 18),
          label: Text(label),
        );
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
          children: [
            const Align(alignment: AlignmentDirectional.centerStart, child: BrandMark(size: 48)),
            const SizedBox(height: 20),
            Text(s.termsTitle, style: theme.textTheme.headlineSmall?.copyWith(fontSize: 26)),
            const SizedBox(height: 10),
            Text(s.termsIntro, style: theme.textTheme.bodyMedium?.copyWith(fontSize: 16, height: 1.7)),
            const SizedBox(height: 20),
            for (final point in s.termsPoints)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(padding: EdgeInsets.only(top: 4), child: Icon(Icons.check_circle, size: 18, color: Brand.route)),
                    const SizedBox(width: 10),
                    Expanded(child: Text(point, style: const TextStyle(height: 1.6))),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            Wrap(spacing: 10, runSpacing: 10, children: [link(s.terms, widget.config.termsUrl), link(s.privacy, widget.config.privacyUrl)]),
            const SizedBox(height: 20),
            CheckboxListTile(
              value: _agreed,
              onChanged: (v) => setState(() => _agreed = v ?? false),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(s.termsAgree),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: Brand.red))),
            FilledButton(onPressed: _agreed && !_busy ? _accept : null, child: _busy ? const ButtonSpinner() : Text(s.termsAccept)),
            const SizedBox(height: 8),
            TextButton(onPressed: () => ref.read(sessionProvider.notifier).signOut(), child: Text(s.signOut)),
          ],
        ),
      ),
    );
  }
}

/// The emergency button: call 911, or alert the operations team with the current location.
class SosButton extends ConsumerWidget {
  const SosButton({super.key, this.tripId, this.locate, this.dark = false});

  final String? tripId;

  /// Where the caller is, if the app knows (the driver app reads GPS). Null: sent without location.
  final Future<({double lat, double lng})?> Function()? locate;
  final bool dark;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = Strings.of(context);
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: dark ? const Color(0xFFFF8A80) : Brand.red,
        side: BorderSide(color: dark ? const Color(0xFFFF8A80) : Brand.red),
        minimumSize: const Size(0, 44),
      ),
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (_) => _SosSheet(tripId: tripId, locate: locate),
      ),
      icon: const Icon(Icons.emergency_outlined, size: 20),
      label: Text(s.sos),
    );
  }
}

class _SosSheet extends ConsumerStatefulWidget {
  const _SosSheet({this.tripId, this.locate});
  final String? tripId;
  final Future<({double lat, double lng})?> Function()? locate;

  @override
  ConsumerState<_SosSheet> createState() => _SosSheetState();
}

class _SosSheetState extends ConsumerState<_SosSheet> {
  bool _busy = false;

  Future<void> _report() async {
    final s = Strings.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    try {
      ({double lat, double lng})? at;
      try {
        at = await widget.locate?.call().timeout(const Duration(seconds: 6));
      } catch (_) {
        at = null;
      }
      await ref.read(apiClientProvider).post('/v1/support/tickets/sos', data: {
        if (widget.tripId != null) 'tripId': widget.tripId,
        if (at != null) 'lat': at.lat,
        if (at != null) 'lng': at.lng,
      });
      navigator.pop();
      messenger.showSnackBar(SnackBar(content: Text(s.sosSent), backgroundColor: Brand.route, duration: const Duration(seconds: 6)));
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        messenger.showSnackBar(SnackBar(content: Text(describeError(context, e))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final emergency = ref.watch(serverConfigProvider).valueOrNull?.emergencyNumber ?? '911';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(s.sosTitle, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 6),
            Text(s.sosIntro),
            const SizedBox(height: 18),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: Brand.red, minimumSize: const Size.fromHeight(56)),
              onPressed: () => launchUrl(Uri.parse('tel:$emergency')),
              icon: const Icon(Icons.call),
              label: Text(s.sosCall(emergency)),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              onPressed: _busy ? null : _report,
              icon: _busy ? const ButtonSpinner() : const Icon(Icons.support_agent),
              label: Text(s.sosReport),
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens WhatsApp with the support number, when the team has set one.
class WhatsAppHelpButton extends ConsumerWidget {
  const WhatsAppHelpButton({super.key, this.message = ''});
  final String message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final uri = ref.watch(serverConfigProvider).valueOrNull?.whatsapp(message);
    if (uri == null) return const SizedBox.shrink();
    return OutlinedButton.icon(
      onPressed: () => launchUrl(uri, mode: LaunchMode.externalApplication),
      icon: const Icon(Icons.chat_outlined),
      label: Text(Strings.of(context).whatsappSupport),
    );
  }
}
