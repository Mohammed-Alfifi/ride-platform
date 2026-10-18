import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'models.dart';
import 'repository.dart';
import 'strings.dart';

/// Opens the gateway's hosted payment page (mada, cards, Apple Pay, STC Pay) and closes as
/// soon as the gateway sends the rider back to our return URL. The result is never taken
/// from the page: the app asks the server, which confirms with the gateway.
///
/// Pops with the final [Payment] (paid, failed, or still initiated if confirmation is slow).
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key, required this.paymentId, required this.checkoutUrl});

  final String paymentId;
  final String checkoutUrl;

  /// Opens checkout and returns the confirmed payment, or null if the rider closed it.
  static Future<Payment?> open(BuildContext context, {required String paymentId, required String checkoutUrl}) {
    if (kIsWeb) return _openOnWeb(context, paymentId, checkoutUrl);
    return Navigator.of(context).push<Payment>(
      MaterialPageRoute(fullscreenDialog: true, builder: (_) => CheckoutScreen(paymentId: paymentId, checkoutUrl: checkoutUrl)),
    );
  }

  /// Web build: the payment page opens in a new tab; the rider comes back and the app asks the
  /// server for the result (the server confirms with the gateway, as on the phone).
  static Future<Payment?> _openOnWeb(BuildContext context, String paymentId, String checkoutUrl) async {
    await launchUrl(Uri.parse(checkoutUrl), webOnlyWindowName: '_blank');
    if (!context.mounted) return null;
    return showDialog<Payment>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _WebCheckoutWait(paymentId: paymentId),
    );
  }

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  late final WebViewController _web;
  bool _loading = true;
  bool _confirming = false;

  bool _isReturn(String url) => Uri.tryParse(url)?.path == '/v1/payments/${widget.paymentId}/return';

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => setState(() => _loading = true),
          onPageFinished: (_) => setState(() => _loading = false),
          onNavigationRequest: (req) {
            if (_isReturn(req.url)) {
              _confirm();
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.checkoutUrl));
  }

  Future<void> _confirm() async {
    if (_confirming) return;
    setState(() => _confirming = true);
    try {
      final payment = await ref.read(riderRepositoryProvider).waitForPayment(widget.paymentId);
      if (mounted) Navigator.of(context).pop(payment);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(describeError(context, e))));
      Navigator.of(context).pop();
    }
  }

  /// Closing by hand still checks with the server: the rider may have paid just before.
  Future<void> _close() async {
    Payment? payment;
    try {
      payment = await ref.read(riderRepositoryProvider).payment(widget.paymentId);
    } catch (_) {
      payment = null;
    }
    if (mounted) Navigator.of(context).pop(payment?.status == 'initiated' ? null : payment);
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_confirming) _close();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(icon: const Icon(Icons.close), onPressed: _confirming ? null : _close),
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [const Icon(Icons.lock_outline, size: 18), const SizedBox(width: 6), Text(t.securePayment)],
          ),
          bottom: _loading && !_confirming
              ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2))
              : null,
        ),
        body: _confirming
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [const CircularProgressIndicator(), const SizedBox(height: 16), Text(t.confirming)],
                ),
              )
            : WebViewWidget(controller: _web),
      ),
    );
  }
}

class _WebCheckoutWait extends ConsumerStatefulWidget {
  const _WebCheckoutWait({required this.paymentId});
  final String paymentId;

  @override
  ConsumerState<_WebCheckoutWait> createState() => _WebCheckoutWaitState();
}

class _WebCheckoutWaitState extends ConsumerState<_WebCheckoutWait> {
  bool _checking = false;

  Future<void> _check() async {
    setState(() => _checking = true);
    Payment? payment;
    try {
      payment = await ref.read(riderRepositoryProvider).payment(widget.paymentId);
    } catch (_) {
      payment = null;
    }
    if (!mounted) return;
    if (payment != null && payment.status != 'initiated') {
      Navigator.of(context).pop(payment);
    } else {
      setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = RiderStrings.of(context);
    return AlertDialog(
      title: Text(t.securePayment),
      content: Text(t.webPayWait),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.back)),
        FilledButton(onPressed: _checking ? null : _check, child: _checking ? const ButtonSpinner() : Text(t.webPayDone)),
      ],
    );
  }
}
