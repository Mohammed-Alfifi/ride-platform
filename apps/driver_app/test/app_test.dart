import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:driver_app/home_screen.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/testing.dart';

void main() {
  testWidgets('signed-out drivers see the driver sign-up intro and can switch to English', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            const AppConfig(audience: AppAudience.driver, apiUrl: 'http://localhost'),
          ),
          tokenStoreProvider.overrideWithValue(TokenStore(MemorySecureStorage())),
        ],
        child: RideApp(title: 'Driver', home: (_) => const DriverHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('سجّل بجوالك للانضمام كسائق لدى شريك نقل مرخّص.'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byType(TextField))), TextDirection.rtl);

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(find.text('Enter your mobile number'), findsOneWidget);
  });
}
