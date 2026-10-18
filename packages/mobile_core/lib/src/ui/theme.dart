import 'package:flutter/material.dart';

/// Mishwar's palette, shared with the operations dashboard: asphalt ink, guide-sign green,
/// and one warm accent (the sun) kept for the arrival point and time remaining.
class Brand {
  static const ink = Color(0xFF18263A);
  static const inkSoft = Color(0xFF4A5A6E);
  static const night = Color(0xFF10202F); // driver app background, made for glancing at while driving
  static const nightLine = Color(0xFF1E3349);
  static const nightSoft = Color(0xFF9FB0C0);
  static const surface = Color(0xFFF3F6F7);
  static const line = Color(0xFFD9E0E4);
  static const route = Color(0xFF0B6E4F);
  static const routeDeep = Color(0xFF075A40);
  static const routeTint = Color(0xFFE3F1EC);
  static const routeBright = Color(0xFF3FBF8F);
  static const sun = Color(0xFFF2B33D);
  static const sunTint = Color(0xFFFFF4DC);
  static const sunDeep = Color(0xFF7A4C05);
  static const amber = Color(0xFFA86A0C);
  static const red = Color(0xFFB42318);
  static const redTint = Color(0xFFFCE7E5);

  static const appName = 'مشوار';
}

/// Fonts are passed in by each app (so tests run without fetching them):
/// [body] restyles the text theme (IBM Plex Sans Arabic), [display] names the family for
/// headings and large numbers (Readex Pro).
ThemeData buildTheme({TextTheme Function(TextTheme base)? body, String? display}) {
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.route,
    primary: Brand.route,
    onPrimary: Colors.white,
    secondary: Brand.sun,
    onSecondary: Brand.ink,
    surface: Colors.white,
    onSurface: Brand.ink,
    error: Brand.red,
  );
  final border = OutlineInputBorder(
    borderRadius: BorderRadius.circular(14),
    borderSide: const BorderSide(color: Brand.line),
  );
  const base = TextTheme(
    headlineMedium: TextStyle(fontWeight: FontWeight.w700, color: Brand.ink, height: 1.2),
    headlineSmall: TextStyle(fontWeight: FontWeight.w700, color: Brand.ink, height: 1.25),
    titleLarge: TextStyle(fontWeight: FontWeight.w700, color: Brand.ink),
    titleMedium: TextStyle(fontWeight: FontWeight.w600, color: Brand.ink),
    bodyLarge: TextStyle(color: Brand.ink, height: 1.55),
    bodyMedium: TextStyle(color: Brand.inkSoft, height: 1.55),
    bodySmall: TextStyle(color: Brand.inkSoft, height: 1.45),
    labelLarge: TextStyle(fontWeight: FontWeight.w600),
  );
  var text = body == null ? base : body(base);
  if (display != null) {
    TextStyle? d(TextStyle? s) => s?.copyWith(fontFamily: display);
    text = text.copyWith(
      headlineMedium: d(text.headlineMedium),
      headlineSmall: d(text.headlineSmall),
      titleLarge: d(text.titleLarge),
    );
  }
  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(16));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.surface,
    textTheme: text,
    fontFamily: body == null ? null : text.bodyMedium?.fontFamily,
    appBarTheme: AppBarTheme(
      backgroundColor: Brand.surface,
      foregroundColor: Brand.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(fontSize: 22),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(borderSide: const BorderSide(color: Brand.route, width: 2)),
      errorBorder: border.copyWith(borderSide: const BorderSide(color: Brand.red)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        shape: buttonShape,
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: buttonShape,
        foregroundColor: Brand.ink,
        side: const BorderSide(color: Brand.line, width: 1.5),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: Brand.line)),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      side: const BorderSide(color: Brand.line),
      selectedColor: Brand.route,
      checkmarkColor: Colors.white,
      secondaryLabelStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: Brand.routeTint,
      surfaceTintColor: Colors.transparent,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 12,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          color: s.contains(WidgetState.selected) ? Brand.route : Brand.inkSoft,
        ),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Brand.ink,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  );
}

/// A small status label with a coloured dot, as on the dashboard.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.tone});

  /// ok (green) | wait (amber) | bad (red) | live (bright green on dark)
  final String tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, dot) = switch (tone) {
      'ok' => (Brand.routeTint, Brand.routeDeep, Brand.route),
      'wait' => (Brand.sunTint, Brand.sunDeep, Brand.amber),
      'bad' => (Brand.redTint, const Color(0xFF8E1C13), Brand.red),
      _ => (const Color(0x263FBF8F), Brand.routeBright, Brand.routeBright),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

/// A Saudi plate as it reads on the car: digits, then Latin letters, always left to right.
class PlateChip extends StatelessWidget {
  const PlateChip(this.plate, {super.key, this.dark = false});
  final String plate;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final parts = plate.split(' ');
    final color = dark ? Colors.white : Brand.ink;
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Container(
        decoration: BoxDecoration(border: Border.all(color: color, width: 2), borderRadius: BorderRadius.circular(5)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            child: Text(parts.first, style: TextStyle(color: color, fontWeight: FontWeight.w800, letterSpacing: 1)),
          ),
          if (parts.length > 1) ...[
            Container(width: 2, height: 22, color: color),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              child: Text(parts.sublist(1).join(' '), style: TextStyle(color: color, fontWeight: FontWeight.w800, letterSpacing: 1)),
            ),
          ],
        ]),
      ),
    );
  }
}
