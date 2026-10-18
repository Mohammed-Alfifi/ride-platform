import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session_controller.dart';
import '../l10n/strings.dart';
import '../phone.dart';
import 'app_shell.dart';

class OtpArgs {
  const OtpArgs({required this.phone, required this.resendAfter, this.accessCode = false});
  final String phone;
  final int resendAfter;

  /// Invite-only pilot without SMS: the person types the 8-digit code the team sent on WhatsApp.
  final bool accessCode;
}

class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, required this.args});
  final OtpArgs args;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _controller = TextEditingController();
  Timer? _timer;
  late int _resendIn = widget.args.resendAfter;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_resendIn <= 1) t.cancel();
      setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
    });
  }

  Future<void> _verify() async {
    final code = _controller.text.trim();
    if (code.length < 4 || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).verifyOtp(widget.args.phone, code);
      // The router redirect takes the user home once the session is set.
    } catch (e) {
      if (mounted) {
        setState(() => _error = describeError(context, e));
        _controller.clear();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    setState(() => _error = null);
    try {
      final result = await ref.read(sessionProvider.notifier).requestOtp(widget.args.phone);
      setState(() => _resendIn = result.resendAfter);
      _startTimer();
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final access = widget.args.accessCode;
    final length = access ? 8 : 6;
    return AuthScaffold(
      title: access ? s.accessCodeTitle : s.codeTitle,
      intro: access ? s.accessCodeIntro(formatSaudiMobile(widget.args.phone)) : s.codeSentTo(formatSaudiMobile(widget.args.phone)),
      children: [
        TextField(
          controller: _controller,
          autofocus: true,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          textDirection: TextDirection.ltr,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(length)],
          style: TextStyle(fontSize: 26, letterSpacing: access ? 8 : 12, fontWeight: FontWeight.w600),
          decoration: InputDecoration(errorText: _error, errorMaxLines: 3),
          onChanged: (v) {
            if (v.length == length) _verify();
          },
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _verify,
          child: _busy ? const ButtonSpinner() : Text(s.verify),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(onPressed: () => context.pop(), child: Text(s.changeNumber)),
            if (access)
              Flexible(child: Text(s.accessCodeHelp, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.end))
            else if (_resendIn > 0)
              Text(s.resendIn(_resendIn), style: Theme.of(context).textTheme.bodyMedium)
            else
              TextButton(onPressed: _resend, child: Text(s.resend)),
          ],
        ),
      ],
    );
  }
}
