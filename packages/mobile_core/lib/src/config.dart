import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Which app is running. Matches the API's `app` field and decides which account signs in.
enum AppAudience { rider, driver }

class AppConfig {
  const AppConfig({required this.audience, required this.apiUrl});

  final AppAudience audience;

  /// Set at build time: flutter run --dart-define=API_URL=https://api.example.sa
  /// The default reaches a local API from the Android emulator.
  final String apiUrl;

  static const String defaultApiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );
}

/// Overridden in each app's main() with its own audience.
final appConfigProvider = Provider<AppConfig>(
  (ref) => throw UnimplementedError('Override appConfigProvider in main()'),
);
