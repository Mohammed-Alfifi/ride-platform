import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session_controller.dart';
import '../l10n/strings.dart';
import 'otp_screen.dart';
import 'phone_screen.dart';
import 'profile_screen.dart';
import 'theme.dart';

/// The shared app frame: theme, Arabic/English, and sign-in routing.
/// Each app passes its own home screen; everything before it is shared.
class RideApp extends ConsumerStatefulWidget {
  const RideApp({super.key, required this.title, required this.home, this.theme});

  final String title;
  final WidgetBuilder home;

  /// The app's theme with its fonts; tests leave it out and get the same theme in the system font.
  final ThemeData? theme;

  @override
  ConsumerState<RideApp> createState() => _RideAppState();
}

class _RideAppState extends ConsumerState<RideApp> {
  late final _refresh = _RouterRefresh();
  late final GoRouter _router = GoRouter(
    initialLocation: '/',
    refreshListenable: _refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final atAuth = state.matchedLocation == '/login' || state.matchedLocation == '/otp';
      if (session.isLoading || session.hasError) return state.matchedLocation == '/' ? null : '/';
      final signedIn = session.valueOrNull != null;
      if (!signedIn) return atAuth ? null : '/login';
      if (atAuth || state.matchedLocation == '/') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const PhoneScreen()),
      GoRoute(
        path: '/otp',
        builder: (_, state) {
          final args = state.extra;
          return args is OtpArgs ? OtpScreen(args: args) : const PhoneScreen();
        },
      ),
      GoRoute(path: '/home', builder: (context, _) => widget.home(context)),
      GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
    ],
  );

  @override
  void dispose() {
    _router.dispose();
    _refresh.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(sessionProvider, (_, __) => _refresh.ping());
    final locale = ref.watch(languageProvider);
    return MaterialApp.router(
      title: widget.title,
      debugShowCheckedModeBanner: false,
      theme: widget.theme ?? buildTheme(),
      locale: locale,
      supportedLocales: supportedLocales,
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: _router,
    );
  }
}

class _RouterRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final s = Strings.of(context);
    return Scaffold(
      body: Center(
        child: session.hasError
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(describeError(context, session.error!), textAlign: TextAlign.center),
                  ),
                  OutlinedButton(
                    onPressed: () => ref.read(sessionProvider.notifier).retry(),
                    child: Text(s.retry),
                  ),
                ],
              )
            : const CircularProgressIndicator(),
      ),
    );
  }
}

/// Layout for the sign-in steps: a dark band with the brand and the route drawing,
/// then the title, intro and form on the light ground.
class AuthScaffold extends ConsumerWidget {
  const AuthScaffold({super.key, required this.title, required this.intro, required this.children});

  final String title;
  final String intro;
  final List<Widget> children;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = Strings.of(context);
    final lang = ref.watch(languageProvider).languageCode;
    final theme = Theme.of(context);
    return Scaffold(
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          Container(
            color: Brand.ink,
            padding: EdgeInsets.fromLTRB(24, MediaQuery.paddingOf(context).top + 8, 24, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const BrandMark(size: 36),
                    const SizedBox(width: 10),
                    Text(Brand.appName, style: theme.textTheme.titleLarge?.copyWith(color: Colors.white, fontSize: 22)),
                    const Spacer(),
                    TextButton(
                      onPressed: () => ref.read(sessionProvider.notifier).setLanguage(lang == 'ar' ? 'en' : 'ar'),
                      style: TextButton.styleFrom(foregroundColor: Brand.routeBright),
                      child: Text(s.otherLanguage),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                const SizedBox(height: 170, child: CustomPaint(painter: _CityRoutePainter())),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(title, style: theme.textTheme.headlineSmall?.copyWith(fontSize: 28)),
                const SizedBox(height: 8),
                Text(intro, style: theme.textTheme.bodyMedium?.copyWith(fontSize: 16)),
                const SizedBox(height: 28),
                ...children,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The app icon: a dark tile with the route from a hollow start to the sun.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 40});
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: size,
        height: size,
        child: CustomPaint(painter: _BrandMarkPainter()),
      );
}

class _BrandMarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 76;
    canvas.drawRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(20 * k)), Paint()..color = const Color(0xFF22344B));
    final path = Path()
      ..moveTo(18 * k, 50 * k)
      ..cubicTo(30 * k, 50 * k, 30 * k, 26 * k, 44 * k, 26 * k)
      ..cubicTo(52 * k, 26 * k, 58 * k, 30 * k, 58 * k, 30 * k);
    canvas.drawPath(
      path,
      Paint()
        ..color = Brand.routeBright
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5 * k
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(Offset(18 * k, 50 * k), 6.5 * k, Paint()..color = const Color(0xFF22344B));
    canvas.drawCircle(
      Offset(18 * k, 50 * k),
      6.5 * k,
      Paint()
        ..color = Brand.routeBright
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4 * k,
    );
    canvas.drawCircle(Offset(58 * k, 30 * k), 8 * k, Paint()..color = Brand.sun);
  }

  @override
  bool shouldRepaint(_BrandMarkPainter old) => false;
}

/// A few streets and one route across them, from home to the sun.
class _CityRoutePainter extends CustomPainter {
  const _CityRoutePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final street = Paint()
      ..color = const Color(0xFF22344B)
      ..strokeWidth = 14
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(-10, h * 0.25), Offset(w + 10, h * 0.12), street);
    canvas.drawLine(Offset(-10, h * 0.78), Offset(w + 10, h * 0.7), street);
    canvas.drawLine(Offset(w * 0.25, -10), Offset(w * 0.3, h + 10), street);
    canvas.drawLine(Offset(w * 0.72, -10), Offset(w * 0.68, h + 10), street);
    final start = Offset(w * 0.2, h * 0.82);
    final end = Offset(w * 0.8, h * 0.2);
    final route = Path()
      ..moveTo(start.dx, start.dy)
      ..cubicTo(w * 0.35, h * 0.8, w * 0.4, h * 0.35, w * 0.55, h * 0.38)
      ..cubicTo(w * 0.68, h * 0.4, w * 0.72, h * 0.22, end.dx, end.dy);
    canvas.drawPath(
      route,
      Paint()
        ..color = Brand.routeBright
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(start, 10, Paint()..color = Brand.ink);
    canvas.drawCircle(
      start,
      10,
      Paint()
        ..color = Brand.routeBright
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5,
    );
    canvas.drawCircle(end, 18, Paint()..color = Brand.sun.withAlpha(64));
    canvas.drawCircle(end, 11, Paint()..color = Brand.sun);
  }

  @override
  bool shouldRepaint(_CityRoutePainter old) => false;
}

/// The brand's route line: three stops joined by a line, the last one lit.
class RouteMark extends StatelessWidget {
  const RouteMark({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 28,
      child: CustomPaint(painter: _RouteMarkPainter(Directionality.of(context))),
    );
  }
}

class _RouteMarkPainter extends CustomPainter {
  _RouteMarkPainter(this.direction);
  final TextDirection direction;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    const gap = 44.0;
    final xs = [8.0, 8 + gap, 8 + gap * 2];
    final pos = direction == TextDirection.rtl ? xs.map((x) => size.width - x).toList() : xs;
    final line = Paint()
      ..color = Brand.routeBright
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(pos.first, y), Offset(pos.last, y), line);
    for (var i = 0; i < pos.length; i++) {
      final last = i == pos.length - 1;
      canvas.drawCircle(Offset(pos[i], y), last ? 7 : 5.5, Paint()..color = last ? Brand.routeBright : Brand.surface);
      canvas.drawCircle(
        Offset(pos[i], y),
        last ? 7 : 5.5,
        Paint()
          ..color = Brand.routeBright
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5,
      );
    }
  }

  @override
  bool shouldRepaint(_RouteMarkPainter old) => old.direction != direction;
}

class ButtonSpinner extends StatelessWidget {
  const ButtonSpinner({super.key});

  @override
  Widget build(BuildContext context) =>
      const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white));
}
