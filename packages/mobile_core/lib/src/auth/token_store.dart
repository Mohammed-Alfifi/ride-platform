import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredTokens {
  const StoredTokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
}

/// Keeps tokens in the Keychain (iOS) and encrypted shared preferences (Android).
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _storage;
  static const _access = 'access_token';
  static const _refresh = 'refresh_token';

  StoredTokens? _cache;
  bool _loaded = false;

  Future<StoredTokens?> read() async {
    if (_loaded) return _cache;
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    _cache = access != null && refresh != null
        ? StoredTokens(accessToken: access, refreshToken: refresh)
        : null;
    _loaded = true;
    return _cache;
  }

  Future<void> save(String accessToken, String refreshToken) async {
    _cache = StoredTokens(accessToken: accessToken, refreshToken: refreshToken);
    _loaded = true;
    await _storage.write(key: _access, value: accessToken);
    await _storage.write(key: _refresh, value: refreshToken);
  }

  Future<void> clear() async {
    _cache = null;
    _loaded = true;
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}
