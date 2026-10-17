import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_core/mobile_core.dart';

/// Phase 1 home: shows whether the driver is approved. Document upload and the day's
/// route arrive in phases 2 and 4.
class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).valueOrNull;
    final t = _DriverStrings.of(context);
    if (user == null) return const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(
        title: Text(user.needsName ? t.title : user.name!),
        actions: [
          IconButton(
            tooltip: Strings.of(context).profile,
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(sessionProvider.notifier).retry(),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (user.isPending)
              _StatusPanel(color: Brand.amber, title: t.pendingTitle, body: t.pendingBody)
            else if (user.status == 'active')
              _StatusPanel(color: Brand.route, title: t.activeTitle, body: t.activeBody),
            if (user.needsName) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: () => context.push('/profile'), child: Text(t.addName)),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusPanel extends StatelessWidget {
  const _StatusPanel({required this.color, required this.title, required this.body});
  final Color color;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    // A rounded panel with a coloured edge: clip the corners, draw the edge as a plain border.
    return ClipRRect(
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
            const SizedBox(height: 6),
            Text(body, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class _DriverStrings {
  const _DriverStrings(this._ar);
  final bool _ar;

  static _DriverStrings of(BuildContext context) =>
      _DriverStrings(Localizations.localeOf(context).languageCode != 'en');

  String get title => _ar ? 'تطبيق السائق' : 'Driver';
  String get pendingTitle => _ar ? 'حسابك قيد المراجعة' : 'Your account is under review';
  String get pendingBody => _ar
      ? 'قريبا ترفع رخصتك ووثائق مركبتك هنا، ويعتمدك شريك النقل قبل أن تستلم أي رحلة.'
      : 'Soon you will upload your licence and vehicle documents here, and a transport partner approves you before your first trip.';
  String get activeTitle => _ar ? 'حسابك معتمد' : 'You are approved';
  String get activeBody => _ar
      ? 'لا توجد مسارات اليوم. ستظهر مساراتك هنا بترتيب المحطات.'
      : 'No routes today. Your routes will appear here with their stops in order.';
  String get addName => _ar ? 'أضف اسمك' : 'Add your name';
}
