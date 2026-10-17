import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/session_controller.dart';
import '../l10n/strings.dart';
import '../phone.dart';

/// Name, language and sign-out. Shared by both apps.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late final TextEditingController _name =
      TextEditingController(text: ref.read(sessionProvider).valueOrNull?.name ?? '');
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = _name.text.trim();
    if (value.length < 2) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final s = Strings.of(context);
    try {
      await ref.read(sessionProvider.notifier).updateName(value);
      messenger.showSnackBar(SnackBar(content: Text(s.saved)));
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text(describeError(context, e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signOutEverywhere() async {
    final s = Strings.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(s.signOutEverywhereConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(s.cancel)),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(s.signOutEverywhere)),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).signOutEverywhere();
  }

  @override
  Widget build(BuildContext context) {
    final s = Strings.of(context);
    final user = ref.watch(sessionProvider).valueOrNull;
    final lang = ref.watch(languageProvider).languageCode;
    if (user == null) return const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(title: Text(s.profile)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: s.name, helperText: s.nameHint),
          ),
          const SizedBox(height: 12),
          FilledButton(onPressed: _saving ? null : _save, child: Text(s.save)),
          const SizedBox(height: 28),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(s.phoneNumber),
            trailing: Text(formatSaudiMobile(user.phone), textDirection: TextDirection.ltr),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(s.language),
            trailing: TextButton(
              onPressed: () => ref.read(sessionProvider.notifier).setLanguage(lang == 'ar' ? 'en' : 'ar'),
              child: Text(s.otherLanguage),
            ),
          ),
          const Divider(height: 32),
          TextButton(
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
            child: Text(s.signOut),
          ),
          TextButton(
            onPressed: _signOutEverywhere,
            style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
            child: Text(s.signOutEverywhere),
          ),
        ],
      ),
    );
  }
}
