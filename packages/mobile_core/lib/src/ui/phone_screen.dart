import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session_controller.dart';
import '../config.dart';
import '../l10n/strings.dart';
import '../phone.dart';
import 'app_shell.dart';
import 'otp_screen.dart';

class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final s = Strings.of(context);
    final phone = normalizeSaudiMobile(_controller.text);
    if (phone == null) {
      setState(() => _error = s.phoneInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(sessionProvider.notifier).requestOtp(phone);
      if (!mounted) return;
      context.push('/otp', extra: OtpArgs(phone: phone, resendAfter: result.resendAfter, accessCode: result.accessCode));
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final audience = ref.watch(appConfigProvider).audience;
    return AuthScaffold(
      title: s.phoneTitle,
      intro: audience == AppAudience.driver ? s.phoneIntroDriver : s.phoneIntroRider,
      children: [
        TextField(
          controller: _controller,
          autofocus: true,
          keyboardType: TextInputType.phone,
          textDirection: TextDirection.ltr,
          autofillHints: const [AutofillHints.telephoneNumber],
          inputFormatters: [LengthLimitingTextInputFormatter(16)],
          decoration: InputDecoration(
            labelText: s.phoneLabel,
            hintText: '05XXXXXXXX',
            errorText: _error,
          ),
          onSubmitted: (_) => _submit(),
        ),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy ? const ButtonSpinner() : Text(s.sendCode),
        ),
      ],
    );
  }
}
