import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_core/mobile_core.dart';

/// Phase 1 home: greets the rider, asks for a name on first sign-in, and holds the place
/// where subscriptions and today's trips arrive in phase 3.
class RiderHomeScreen extends ConsumerWidget {
  const RiderHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).valueOrNull;
    final t = _RiderStrings.of(context);
    if (user == null) return const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(
        title: Text(user.needsName ? t.welcome : t.hello(user.name!)),
        actions: [
          IconButton(
            tooltip: Strings.of(context).profile,
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (user.needsName) const _NameCard(),
          const SizedBox(height: 8),
          _EmptyState(title: t.noSubscriptionTitle, body: t.noSubscriptionBody),
        ],
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
  const _EmptyState({required this.title, required this.body});
  final String title;
  final String body;

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
        ],
      ),
    );
  }
}

class _RiderStrings {
  const _RiderStrings(this._ar);
  final bool _ar;

  static _RiderStrings of(BuildContext context) =>
      _RiderStrings(Localizations.localeOf(context).languageCode != 'en');

  String get welcome => _ar ? 'أهلا بك' : 'Welcome';
  String hello(String name) => _ar ? 'مرحبا، $name' : 'Hello, $name';
  String get noSubscriptionTitle => _ar ? 'لا يوجد اشتراك بعد' : 'No subscription yet';
  String get noSubscriptionBody => _ar
      ? 'قريبا تختار أماكن الذهاب والعودة وأيام الأسبوع، ونرتب لك سائقا ثابتا يصل في موعده.'
      : 'Soon you will pick your pick-up and drop-off, your days of the week, and get a regular driver who arrives on time.';
}
