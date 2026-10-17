import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../config.dart';
import '../models/user_profile.dart';
import 'token_store.dart';

class OtpRequestResult {
  const OtpRequestResult({required this.expiresIn, required this.resendAfter});
  final int expiresIn;
  final int resendAfter;
}

class SignInResult {
  const SignInResult({required this.user, required this.isNewUser});
  final UserProfile user;
  final bool isNewUser;
}

/// The auth and profile endpoints of the API.
class AuthRepository {
  AuthRepository(this._api, this._tokens, this._audience);

  final ApiClient _api;
  final TokenStore _tokens;
  final AppAudience _audience;

  Future<OtpRequestResult> requestOtp(String phone) async {
    final body = await _api.post(
      '/v1/auth/otp/request',
      data: {'phone': phone, 'app': _audience.name},
      auth: false,
    );
    return OtpRequestResult(
      expiresIn: (body['expiresIn'] as num).toInt(),
      resendAfter: (body['resendAfter'] as num).toInt(),
    );
  }

  Future<SignInResult> verifyOtp(String phone, String code) async {
    final body = await _api.post(
      '/v1/auth/otp/verify',
      data: {'phone': phone, 'app': _audience.name, 'code': code},
      auth: false,
    );
    await _tokens.save(body['accessToken'] as String, body['refreshToken'] as String);
    return SignInResult(
      user: UserProfile.fromJson(body['user'] as Map<String, dynamic>),
      isNewUser: body['isNewUser'] == true,
    );
  }

  Future<UserProfile> me() async => UserProfile.fromJson(await _api.get('/v1/me'));

  Future<UserProfile> updateMe({String? name, String? locale}) async {
    final body = await _api.patch('/v1/me', data: {
      if (name != null) 'name': name,
      if (locale != null) 'locale': locale,
    });
    return UserProfile.fromJson(body);
  }

  Future<void> signOut() async {
    final stored = await _tokens.read();
    await _tokens.clear();
    if (stored != null) {
      try {
        await _api.post('/v1/auth/logout', data: {'refreshToken': stored.refreshToken}, auth: false);
      } catch (_) {
        // Signed out locally either way.
      }
    }
  }

  Future<void> signOutEverywhere() async {
    try {
      await _api.post('/v1/auth/logout-all');
    } finally {
      await _tokens.clear();
    }
  }

  Future<bool> hasStoredSession() async => await _tokens.read() != null;
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    ref.watch(apiClientProvider),
    ref.watch(tokenStoreProvider),
    ref.watch(appConfigProvider).audience,
  );
});
