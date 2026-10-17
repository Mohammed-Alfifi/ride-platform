import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/testing.dart';
import 'package:rider_app/home_screen.dart';

void main() {
  testWidgets('signed-out riders land on the phone screen in Arabic', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            const AppConfig(audience: AppAudience.rider, apiUrl: 'http://localhost'),
          ),
          tokenStoreProvider.overrideWithValue(TokenStore(MemorySecureStorage())),
        ],
        child: RideApp(title: 'Rider', home: (_) => const RiderHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('أدخل رقم جوالك'), findsOneWidget);
    expect(find.text('إرسال الرمز'), findsOneWidget);
  });

  testWidgets('rejects a non-Saudi number before calling the server', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            const AppConfig(audience: AppAudience.rider, apiUrl: 'http://localhost'),
          ),
          tokenStoreProvider.overrideWithValue(TokenStore(MemorySecureStorage())),
        ],
        child: RideApp(title: 'Rider', home: (_) => const RiderHomeScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '0112345678');
    await tester.tap(find.text('إرسال الرمز'));
    await tester.pump();
    expect(find.text('أدخل رقم جوال سعودي يبدأ بـ 05'), findsOneWidget);
  });
}
