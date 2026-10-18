import 'package:dio/dio.dart' show Options, ResponseType;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../platform/open_html.dart' if (dart.library.js_interop) '../platform/open_html_web.dart';

import 'models.dart';
import 'new_subscription_screen.dart' show RepoErrors;
import 'repository.dart';
import 'strings.dart';

/// Invoices (simplified tax invoices with the ZATCA QR, or receipts) and saved cards.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    final invoices = ref.watch(invoicesProvider);
    final cards = ref.watch(cardsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(t.invoicesAndCards)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(invoicesProvider);
          ref.invalidate(cardsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(t.cards, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            ...cards.when(
              loading: () => [const LinearProgressIndicator()],
              error: (e, _) => [Text(describeError(context, e))],
              data: (list) => list.isEmpty
                  ? [Text(t.noCards, style: theme.textTheme.bodyMedium)]
                  : [for (final c in list) _CardTile(card: c)],
            ),
            const SizedBox(height: 28),
            Text(t.invoices, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            ...invoices.when(
              loading: () => [const LinearProgressIndicator()],
              error: (e, _) => [Text(describeError(context, e))],
              data: (list) => list.isEmpty
                  ? [Text(t.noInvoices, style: theme.textTheme.bodyMedium)]
                  : [
                      for (final inv in list)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.receipt_long_outlined, color: Brand.inkSoft),
                          title: Text(inv.description, maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text('${inv.number}  ·  ${t.day(inv.issuedAt)}  ·  ${inv.taxInvoice ? t.taxInvoice : t.receipt}'),
                          trailing: Text(t.sar(inv.totalHalalas), style: const TextStyle(fontWeight: FontWeight.w600)),
                          onTap: () => kIsWeb
                              ? _openOnWeb(context, ref, inv)
                              : Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => InvoiceScreen(invoice: inv))),
                        ),
                    ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CardTile extends ConsumerWidget {
  const _CardTile({required this.card});
  final SavedCard card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = RiderStrings.of(context);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.credit_card, color: Brand.inkSoft),
      title: Text('${card.brand} •••• ${card.last4}', textDirection: TextDirection.ltr, textAlign: t.ar ? TextAlign.right : TextAlign.left),
      subtitle: card.expMonth != null && card.expYear != null ? Text(t.expires(card.expMonth!, card.expYear!)) : null,
      trailing: IconButton(
        tooltip: t.removeCard,
        icon: const Icon(Icons.delete_outline),
        onPressed: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              title: Text(t.removeCard),
              content: Text(t.removeCardConfirm),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t.back)),
                TextButton(
                  onPressed: () => Navigator.pop(context, true),
                  style: TextButton.styleFrom(foregroundColor: Brand.red),
                  child: Text(t.removeCard),
                ),
              ],
            ),
          );
          if (ok != true || !context.mounted) return;
          final repo = ref.read(riderRepositoryProvider);
          await RepoErrors(repo).run(context, () => repo.removeCard(card.id));
          ref.invalidate(cardsProvider);
          ref.invalidate(subscriptionsProvider);
        },
      ),
    );
  }
}

/// Web build: fetch the printable invoice with the rider's token and open it in a new tab.
Future<void> _openOnWeb(BuildContext context, WidgetRef ref, Invoice inv) async {
  try {
    final res = await ref.read(apiClientProvider).dio.get<String>(
          '/v1/invoices/${inv.id}',
          options: Options(responseType: ResponseType.plain),
        );
    openHtmlInNewTab(res.data ?? '');
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
  }
}

/// The printable invoice from the API, shown in a web view with the rider's token.
class InvoiceScreen extends ConsumerStatefulWidget {
  const InvoiceScreen({super.key, required this.invoice});
  final Invoice invoice;

  @override
  ConsumerState<InvoiceScreen> createState() => _InvoiceScreenState();
}

class _InvoiceScreenState extends ConsumerState<InvoiceScreen> {
  final _web = WebViewController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final base = ref.read(appConfigProvider).apiUrl;
    final (uri, headers) = await ref.read(riderRepositoryProvider).invoicePage(widget.invoice.id, base);
    await _web.loadRequest(uri, headers: headers);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.invoice.number)),
        body: WebViewWidget(controller: _web),
      );
}
