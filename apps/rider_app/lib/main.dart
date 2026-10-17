import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(
          const AppConfig(audience: AppAudience.rider, apiUrl: AppConfig.defaultApiUrl),
        ),
      ],
      child: RideApp(title: 'Rider', home: (_) => const RiderHomeScreen()),
    ),
  );
}
