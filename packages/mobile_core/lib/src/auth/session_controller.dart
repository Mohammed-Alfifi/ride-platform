import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/api_error.dart';
import '../l10n/strings.dart';
import '../models/user_profile.dart';
import 'auth_repository.dart';

/// The signed-in user, or null when signed out. Loading while a stored session is restored.
class SessionController extends AsyncNotifier<UserProfile?> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  Future<UserProfile?> build() async {
    // If a refresh is rejected anywhere in the app, drop to the sign-in screen.
    ref.read(apiClientProvider).onSessionEnded = () => state = const AsyncData(null);

    if (!await _repo.hasStoredSession()) return null;
    try {
      final user = await _repo.me();
      _applyLanguage(user);
      return user;
    } on ApiError catch (e) {
      if (e.isSessionEnded) return null;
      rethrow; // offline: the UI offers a retry
    }
  }

  Future<OtpRequestResult> requestOtp(String phone) => _repo.requestOtp(phone);

  Future<SignInResult> verifyOtp(String phone, String code) async {
    final result = await _repo.verifyOtp(phone, code);
    var user = result.user;
    final chosen = ref.read(languageProvider).languageCode;
    if (result.isNewUser && chosen != user.locale) {
      // Keep the language the person picked before signing up.
      user = await _repo.updateMe(locale: chosen);
    }
    _applyLanguage(user);
    state = AsyncData(user);
    return SignInResult(user: user, isNewUser: result.isNewUser);
  }

  Future<void> updateName(String name) async {
    state = AsyncData(await _repo.updateMe(name: name));
  }

  Future<void> setLanguage(String code) async {
    ref.read(languageProvider.notifier).state = Locale(code);
    if (state.valueOrNull != null) state = AsyncData(await _repo.updateMe(locale: code));
  }

  Future<void> signOut() async {
    await _repo.signOut();
    state = const AsyncData(null);
  }

  Future<void> signOutEverywhere() async {
    await _repo.signOutEverywhere();
    state = const AsyncData(null);
  }

  Future<void> retry() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }

  void _applyLanguage(UserProfile user) {
    ref.read(languageProvider.notifier).state = Locale(user.locale == 'en' ? 'en' : 'ar');
  }
}

final sessionProvider = AsyncNotifierProvider<SessionController, UserProfile?>(SessionController.new);
