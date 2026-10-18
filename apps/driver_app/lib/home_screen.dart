import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_core/mobile_core.dart';

import 'onboarding/onboarding_controller.dart';
import 'onboarding/onboarding_screen.dart';
import 'onboarding/strings.dart';
import 'trips/today_screen.dart';

/// Until approval: the application checklist. Once approved: the day's trips, with the
/// account (documents and renewals) one tap away.
class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionProvider).valueOrNull;
    if (user == null) return const SizedBox.shrink();
    final t = OnboardingStrings.of(context);
    final tt = TripStrings.of(context);
    final approved = ref.watch(onboardingProvider).valueOrNull?.status == 'approved';
    final showTrips = approved && _tab == 0;

    return Scaffold(
      // Trips are shown on a dark ground: easier to read at a glance in the car, day or night.
      backgroundColor: showTrips ? Brand.night : null,
      appBar: AppBar(
        backgroundColor: showTrips ? Brand.night : null,
        foregroundColor: showTrips ? Colors.white : null,
        titleTextStyle: showTrips ? Theme.of(context).appBarTheme.titleTextStyle?.copyWith(color: Colors.white) : null,
        title: Text(showTrips ? tt.today : (user.needsName ? t.title : user.name!)),
        actions: [
          IconButton(
            tooltip: tt.help,
            icon: const Icon(Icons.support_agent_outlined),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const SupportScreen())),
          ),
          IconButton(
            tooltip: Strings.of(context).profile,
            icon: const Icon(Icons.person_outline),
            onPressed: () => context.push('/profile'),
          ),
        ],
      ),
      body: showTrips ? const TodayView() : const OnboardingView(),
      bottomNavigationBar: approved
          ? NavigationBar(
              selectedIndex: _tab,
              onDestinationSelected: (i) => setState(() => _tab = i),
              destinations: [
                NavigationDestination(icon: const Icon(Icons.route_outlined), selectedIcon: const Icon(Icons.route), label: tt.today),
                NavigationDestination(icon: const Icon(Icons.badge_outlined), selectedIcon: const Icon(Icons.badge), label: tt.account),
              ],
            )
          : null,
    );
  }
}
