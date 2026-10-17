import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_core/mobile_core.dart';
import 'package:mobile_core/testing.dart';

/// Fake server: /v1/me accepts only "fresh" tokens; /v1/auth/refresh rotates "old" -> "fresh".
class FakeAdapter implements HttpClientAdapter {
  int refreshCalls = 0;
  bool refreshFails = false;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (options.path == '/v1/auth/refresh') {
      refreshCalls++;
      if (refreshFails) return _json(401, {'error': {'code': 'AUTH_REFRESH_REUSED', 'message': 'x'}});
      return _json(200, {'accessToken': 'fresh', 'refreshToken': 'rt2', 'accessTokenExpiresIn': 900});
    }
    final auth = options.headers['Authorization'];
    if (auth != 'Bearer fresh') {
      return _json(401, {'error': {'code': 'AUTH_TOKEN_INVALID', 'message': 'expired'}});
    }
    return _json(200, {'ok': true, 'lang': options.headers['Accept-Language']});
  }

  ResponseBody _json(int status, Object body) => ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );

  @override
  void close({bool force = false}) {}
}

void main() {
  late MemorySecureStorage storage;
  late TokenStore tokens;
  late FakeAdapter adapter;
  late ApiClient client;
  var ended = false;

  setUp(() async {
    storage = MemorySecureStorage();
    tokens = TokenStore(storage);
    await tokens.save('old', 'rt1');
    adapter = FakeAdapter();
    ended = false;
    final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter;
    client = ApiClient(
      baseUrl: 'http://api.test',
      tokens: tokens,
      language: () => 'en',
      onSessionEnded: () => ended = true,
      dio: dio,
    );
  });

  test('refreshes an expired token once and retries', () async {
    final body = await client.get('/v1/me');
    expect(body['ok'], true);
    expect(body['lang'], 'en');
    expect(adapter.refreshCalls, 1);
    expect(storage.values['refresh_token'], 'rt2');
  });

  test('shares one refresh between parallel requests', () async {
    final results = await Future.wait([client.get('/v1/me'), client.get('/v1/me'), client.get('/v1/me')]);
    expect(results.every((r) => r['ok'] == true), isTrue);
    expect(adapter.refreshCalls, 1);
  });

  test('ends the session when the refresh is rejected', () async {
    adapter.refreshFails = true;
    await expectLater(client.get('/v1/me'), throwsA(isA<ApiError>()));
    expect(ended, isTrue);
    expect(await tokens.read(), isNull);
  });

  test('maps server errors to ApiError with the server message', () async {
    await tokens.clear();
    try {
      await client.get('/v1/me');
      fail('expected an error');
    } on ApiError catch (e) {
      expect(e.code, 'AUTH_TOKEN_INVALID');
      expect(e.message, 'expired');
      expect(e.status, 401);
    }
  });
}
