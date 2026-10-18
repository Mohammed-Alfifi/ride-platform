import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';

/// Firebase project settings, given at build time (free Firebase plan):
/// --dart-define=FIREBASE_API_KEY=... --dart-define=FIREBASE_APP_ID=... (one per app)
/// --dart-define=FIREBASE_SENDER_ID=... --dart-define=FIREBASE_PROJECT_ID=...
/// Without them the apps still work; notifications then show only in the in-app inbox.
class PushConfig {
  static const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const appId = String.fromEnvironment('FIREBASE_APP_ID');
  static const senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  /// Push on Android (and iOS later). The web version relies on the in-app inbox.
  static bool get enabled =>
      !kIsWeb && apiKey.isNotEmpty && appId.isNotEmpty && senderId.isNotEmpty && projectId.isNotEmpty;
}

/// Registers this phone with the API for push notifications and reports messages that arrive
/// while the app is open (Android shows the others in the notification shade by itself).
class PushService {
  PushService(this._api);

  final ApiClient _api;
  String? _token;
  bool _listening = false;
  final _foreground = StreamController<RemoteNotification>.broadcast();

  /// Notifications received while the app is in front.
  Stream<RemoteNotification> get foreground => _foreground.stream;

  Future<void> register() async {
    if (!PushConfig.enabled) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(
            apiKey: PushConfig.apiKey,
            appId: PushConfig.appId,
            messagingSenderId: PushConfig.senderId,
            projectId: PushConfig.projectId,
          ),
        );
      }
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      _token = await messaging.getToken();
      if (_token != null) await _send(_token!);
      if (!_listening) {
        _listening = true;
        messaging.onTokenRefresh.listen((t) {
          _token = t;
          _send(t);
        });
        FirebaseMessaging.onMessage.listen((m) {
          final n = m.notification;
          if (n != null) _foreground.add(n);
        });
      }
    } catch (e) {
      debugPrint('Push registration failed: $e');
    }
  }

  /// Called on sign-out: this phone stops receiving the account's notifications.
  Future<void> unregister() async {
    final token = _token;
    if (token == null) return;
    try {
      await _api.delete('/v1/notifications/devices', data: {'token': token});
    } catch (_) {
      // Best effort: the server also drops tokens Firebase reports as gone.
    }
  }

  Future<void> _send(String token) async {
    try {
      await _api.post('/v1/notifications/devices', data: {
        'token': token,
        'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      });
    } catch (e) {
      debugPrint('Push token upload failed: $e');
    }
  }
}

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref.watch(apiClientProvider)));
