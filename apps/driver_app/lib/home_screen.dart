import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_core/mobile_core.dart';

import 'onboarding/onboarding_screen.dart';
import 'onboarding/strings.dart';

/// Phase 2 home: the application checklist until approval; afterwards the driver's status,
/// compliance warnings and documents (for renewals). The day's route arrives in phase 4.
class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).valueOrNull;
    if (user == null) return const SizedBox.shrink();
    final t = OnboardingStrings.of(context);

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
      body: const OnboardingView(),
    );
  }
}
