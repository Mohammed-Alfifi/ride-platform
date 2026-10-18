import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
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
      child: RideApp(
        title: 'مشوار',
        theme: buildTheme(body: GoogleFonts.ibmPlexSansArabicTextTheme, display: GoogleFonts.readexPro().fontFamily),
        home: (_) => const RiderHomeScreen(),
      ),
    ),
  );
}
