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
          const AppConfig(audience: AppAudience.driver, apiUrl: AppConfig.defaultApiUrl),
        ),
      ],
      child: RideApp(title: 'Driver', home: (_) => const DriverHomeScreen()),
    ),
  );
}
