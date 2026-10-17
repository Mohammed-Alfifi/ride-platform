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
  const RideApp({super.key, required this.title, required this.home});

  final String title;
  final WidgetBuilder home;

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
      theme: buildTheme(),
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

/// Layout for the sign-in steps: language switch at the top, title, intro, then the form.
class AuthScaffold extends ConsumerWidget {
  const AuthScaffold({super.key, required this.title, required this.intro, required this.children});

  final String title;
  final String intro;
  final List<Widget> children;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = Strings.of(context);
    final lang = ref.watch(languageProvider).languageCode;
    return Scaffold(
      appBar: AppBar(
        actions: [
          TextButton(
            onPressed: () => ref.read(sessionProvider.notifier).setLanguage(lang == 'ar' ? 'en' : 'ar'),
            child: Text(s.otherLanguage),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          children: [
            const RouteMark(),
            const SizedBox(height: 28),
            Text(title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(intro, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 28),
            ...children,
          ],
        ),
      ),
    );
  }
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
