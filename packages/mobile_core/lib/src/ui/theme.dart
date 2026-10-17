import 'package:flutter/material.dart';

/// Shared palette with the admin dashboard: asphalt ink, cool concrete, guide-sign green.
class Brand {
  static const ink = Color(0xFF18263A);
  static const inkSoft = Color(0xFF4A5A6E);
  static const surface = Color(0xFFF3F6F7);
  static const line = Color(0xFFD9E0E4);
  static const route = Color(0xFF0B6E4F);
  static const routeBright = Color(0xFF3FBF8F);
  static const amber = Color(0xFFA86A0C);
  static const red = Color(0xFFB42318);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.route,
    primary: Brand.route,
    onPrimary: Colors.white,
    surface: Colors.white,
    onSurface: Brand.ink,
    error: Brand.red,
  );
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(8),
    borderSide: const BorderSide(color: Brand.line),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.surface,
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.surface,
      foregroundColor: Brand.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(fontWeight: FontWeight.w600, color: Brand.ink, height: 1.3),
      titleMedium: TextStyle(fontWeight: FontWeight.w600, color: Brand.ink),
      bodyLarge: TextStyle(color: Brand.ink, height: 1.5),
      bodyMedium: TextStyle(color: Brand.inkSoft, height: 1.5),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(borderSide: const BorderSide(color: Brand.route, width: 2)),
      errorBorder: border.copyWith(borderSide: const BorderSide(color: Brand.red)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
  );
}
