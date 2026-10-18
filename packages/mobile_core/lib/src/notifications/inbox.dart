import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;

import '../api/api_client.dart';
import '../l10n/strings.dart';
import '../ui/theme.dart';

class InboxItem {
  const InboxItem({required this.id, required this.kind, required this.title, required this.body, required this.read, required this.createdAt});

  final String id;
  final String kind;
  final String title;
  final String body;
  final bool read;
  final DateTime createdAt;

  factory InboxItem.fromJson(Map<String, dynamic> j) => InboxItem(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        body: j['body'] as String,
        read: j['read'] == true,
        createdAt: DateTime.parse(j['createdAt'] as String).toLocal(),
      );
}

/// The user's notifications, newest first (the server sends them in the user's language).
final inboxProvider = FutureProvider.autoDispose<List<InboxItem>>((ref) async {
  final rows = await ref.watch(apiClientProvider).getList('/v1/notifications', query: {'limit': 50});
  return rows.map(InboxItem.fromJson).toList();
});

/// A bell with the number of unread notifications; opens the inbox.
class NotificationsBell extends ConsumerWidget {
  const NotificationsBell({super.key, this.color});
  final Color? color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(inboxProvider).valueOrNull?.where((n) => !n.read).length ?? 0;
    return IconButton(
      tooltip: Strings.of(context).notifications,
      color: color,
      onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const NotificationsScreen())),
      icon: Badge(
        isLabelVisible: unread > 0,
        label: Text('$unread'),
        backgroundColor: Brand.sun,
        textColor: Brand.ink,
        child: const Icon(Icons.notifications_none_rounded),
      ),
    );
  }
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    // Opening the inbox counts as reading it; the list keeps showing what was new this time.
    Future.microtask(() async {
      try {
        await ref.read(apiClientProvider).post('/v1/notifications/read-all');
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final items = ref.watch(inboxProvider);
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final fmt = DateFormat('d MMM، HH:mm', ar ? 'ar' : 'en');
    return PopScope(
      onPopInvokedWithResult: (_, __) => ref.invalidate(inboxProvider),
      child: Scaffold(
        appBar: AppBar(title: Text(s.notifications)),
        body: RefreshIndicator(
          onRefresh: () => ref.refresh(inboxProvider.future),
          child: items.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(describeError(context, e)))]),
            data: (list) => list.isEmpty
                ? ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Text(s.noNotifications, textAlign: TextAlign.center))])
                : ListView.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final n = list[i];
                      final urgent = n.kind == 'sos' || n.kind == 'trip_delayed';
                      return ListTile(
                        leading: Icon(_icon(n.kind), color: urgent ? Brand.red : (n.read ? Brand.inkSoft : Brand.route)),
                        title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700)),
                        subtitle: Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(n.body),
                              const SizedBox(height: 4),
                              Text(fmt.format(n.createdAt), style: const TextStyle(fontSize: 12, color: Brand.inkSoft)),
                            ],
                          ),
                        ),
                        isThreeLine: true,
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }

  IconData _icon(String kind) {
    if (kind.startsWith('payment') || kind.startsWith('renewal')) return Icons.receipt_long_outlined;
    if (kind.startsWith('ticket')) return Icons.support_agent_outlined;
    if (kind == 'sos') return Icons.emergency_outlined;
    if (kind.startsWith('trip') || kind.startsWith('rider') || kind.startsWith('driver')) return Icons.directions_car_outlined;
    return Icons.notifications_none_rounded;
  }
}
