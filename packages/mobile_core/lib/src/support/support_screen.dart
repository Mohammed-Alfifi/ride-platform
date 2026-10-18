import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../l10n/strings.dart';
import '../ui/app_shell.dart';
import '../ui/theme.dart';

class TicketSummary {
  const TicketSummary({required this.id, required this.number, required this.subject, required this.status, required this.category, required this.lastMessageAt});
  factory TicketSummary.fromJson(Map<String, dynamic> j) => TicketSummary(
        id: j['id'] as String,
        number: (j['number'] as num).toInt(),
        subject: j['subject'] as String,
        status: j['status'] as String,
        category: j['category'] as String,
        lastMessageAt: DateTime.parse(j['lastMessageAt'] as String),
      );
  final String id;
  final int number;
  final String subject;
  final String status; // open | answered | closed
  final String category;
  final DateTime lastMessageAt;
}

class TicketMessage {
  const TicketMessage({required this.fromStaff, required this.body, required this.createdAt});
  factory TicketMessage.fromJson(Map<String, dynamic> j) =>
      TicketMessage(fromStaff: j['fromStaff'] == true, body: j['body'] as String, createdAt: DateTime.parse(j['createdAt'] as String));
  final bool fromStaff;
  final String body;
  final DateTime createdAt;
}

final ticketsProvider = FutureProvider.autoDispose<List<TicketSummary>>(
  (ref) async => (await ref.watch(apiClientProvider).getList('/v1/support/tickets')).map(TicketSummary.fromJson).toList(),
);

class _S {
  const _S(this.ar);
  final bool ar;
  static _S of(BuildContext c) => _S(Localizations.localeOf(c).languageCode != 'en');
  String _t(String a, String e) => ar ? a : e;
  String get title => _t('المساعدة والدعم', 'Help and support');
  String get newRequest => _t('طلب جديد', 'New request');
  String get empty => _t('ليس لديك طلبات. اكتب لنا متى احتجت، ونرد عادة خلال ساعات العمل.', 'No requests yet. Write to us any time; we usually reply within working hours.');
  String get subject => _t('الموضوع', 'Subject');
  String get message => _t('اكتب التفاصيل', 'Tell us what happened');
  String get category => _t('النوع', 'Type');
  String get send => _t('إرسال', 'Send');
  String get sent => _t('وصلنا طلبك، وسنرد عليك هنا.', 'We have your request and will reply here.');
  String get reply => _t('اكتب ردا', 'Write a reply');
  String get close => _t('تم حل المشكلة', 'My issue is solved');
  String get closed => _t('هذا الطلب مغلق.', 'This request is closed.');
  String get support => _t('فريق الدعم', 'Support');
  String get you => _t('أنت', 'You');
  String categoryName(String c) => switch (c) {
        'trip' => _t('رحلة', 'Trip'),
        'driver' => _t('السائق', 'Driver'),
        'payment' => _t('الدفع', 'Payment'),
        'app' => _t('التطبيق', 'App'),
        _ => _t('أخرى', 'Other'),
      };
  String status(String s) => switch (s) {
        'open' => _t('بانتظار الرد', 'Waiting for reply'),
        'answered' => _t('تم الرد', 'Answered'),
        _ => _t('مغلق', 'Closed'),
      };
}

/// The user's support requests, and a way to open one. Shared by both apps.
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key, this.tripId});

  /// When opened from a trip, a new request is linked to it.
  final String? tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = _S.of(context);
    final tickets = ref.watch(ticketsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.title)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final created = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => NewTicketScreen(tripId: tripId)));
          if (created == true) ref.invalidate(ticketsProvider);
        },
        icon: const Icon(Icons.edit_outlined),
        label: Text(s.newRequest),
      ),
      body: tickets.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(describeError(context, e))),
        data: (list) => list.isEmpty
            ? Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(s.empty, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: () => ref.refresh(ticketsProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final t = list[i];
                    return Card(
                      child: ListTile(
                        title: Text(t.subject, style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: Text('#${t.number} · ${s.categoryName(t.category)}'),
                        trailing: StatusPill(label: s.status(t.status), tone: t.status == 'answered' ? 'ok' : (t.status == 'open' ? 'wait' : 'bad')),
                        onTap: () async {
                          await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TicketScreen(id: t.id)));
                          ref.invalidate(ticketsProvider);
                        },
                      ),
                    );
                  },
                ),
              ),
      ),
    );
  }
}

class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.tripId});
  final String? tripId;

  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _subject = TextEditingController();
  final _message = TextEditingController();
  late String _category = widget.tripId == null ? 'app' : 'trip';
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = _S.of(context);
    if (_subject.text.trim().length < 3 || _message.text.trim().length < 2) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('/v1/support/tickets', data: {
        'category': _category,
        'subject': _subject.text.trim(),
        'message': _message.text.trim(),
        if (widget.tripId != null) 'tripId': widget.tripId,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.sent)));
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _S.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.newRequest)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(s.category, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in const ['trip', 'driver', 'payment', 'app', 'other'])
                ChoiceChip(label: Text(s.categoryName(c)), selected: _category == c, onSelected: (_) => setState(() => _category = c)),
            ],
          ),
          const SizedBox(height: 20),
          TextField(controller: _subject, maxLength: 120, decoration: InputDecoration(labelText: s.subject, counterText: '')),
          const SizedBox(height: 12),
          TextField(controller: _message, maxLength: 2000, minLines: 5, maxLines: 10, decoration: InputDecoration(labelText: s.message, alignLabelWithHint: true)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _send, child: _busy ? const ButtonSpinner() : Text(s.send)),
        ],
      ),
    );
  }
}

class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();
  Map<String, dynamic>? _ticket;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final t = await ref.read(apiClientProvider).get('/v1/support/tickets/${widget.id}');
    if (mounted) setState(() => _ticket = t);
  }

  Future<void> _do(Future<Map<String, dynamic>> Function(ApiClient api) call) async {
    setState(() => _busy = true);
    try {
      final t = await call(ref.read(apiClientProvider));
      if (mounted) setState(() => _ticket = t);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _S.of(context);
    final t = _ticket;
    if (t == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final messages = (t['messages'] as List).cast<Map<String, dynamic>>().map(TicketMessage.fromJson).toList();
    final closed = t['status'] == 'closed';
    return Scaffold(
      appBar: AppBar(
        title: Text('#${t['number']} ${t['subject']}', overflow: TextOverflow.ellipsis),
        actions: [
          if (!closed)
            TextButton(onPressed: _busy ? null : () => _do((api) => api.post('/v1/support/tickets/${widget.id}/close')), child: Text(s.close)),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final m in messages)
                  Align(
                    alignment: m.fromStaff ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
                    child: Container(
                      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: m.fromStaff ? Brand.routeTint : Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: m.fromStaff ? null : Border.all(color: Brand.line),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(m.fromStaff ? s.support : s.you, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.inkSoft)),
                          const SizedBox(height: 4),
                          Text(m.body, style: const TextStyle(fontSize: 15, color: Brand.ink, height: 1.5)),
                        ],
                      ),
                    ),
                  ),
                if (closed) Padding(padding: const EdgeInsets.all(12), child: Text(s.closed, textAlign: TextAlign.center)),
              ],
            ),
          ),
          if (!closed)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: InputDecoration(hintText: s.reply)),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: s.send,
                      onPressed: _busy
                          ? null
                          : () {
                              final body = _reply.text.trim();
                              if (body.isEmpty) return;
                              _reply.clear();
                              _do((api) => api.post('/v1/support/tickets/${widget.id}/messages', data: {'body': body}));
                            },
                      icon: const Icon(Icons.send),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
