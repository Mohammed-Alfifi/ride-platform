import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/token_store.dart';
import '../config.dart';
import '../l10n/strings.dart';
import 'api_error.dart';

/// HTTP client for the API.
///
/// - Adds the access token and the app language to every request.
/// - On an expired access token, refreshes once (one refresh at a time, even when many
///   requests fail together), stores the rotated pair, and retries the request.
/// - When the refresh is rejected the stored session is cleared and [onSessionEnded] fires.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    required this.language,
    this.onSessionEnded,
    Dio? dio,
  }) : dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: baseUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 20),
                contentType: Headers.jsonContentType,
                responseType: ResponseType.json,
              ),
            ) {
    // Refresh and retry go through a second client without interceptors: a request made
    // from inside a queued error handler on the same client would wait on itself.
    _plain = Dio(this.dio.options)..httpClientAdapter = this.dio.httpClientAdapter;
    this.dio.interceptors.add(
          QueuedInterceptorsWrapper(onRequest: _onRequest, onError: _onError),
        );
  }

  final Dio dio;
  late final Dio _plain;
  final TokenStore tokens;
  final String Function() language;
  void Function()? onSessionEnded;

  static const _skipAuth = 'skipAuth';
  static const _retried = 'retried';

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => dio.get<dynamic>(path, queryParameters: query));

  /// For endpoints that answer with a JSON array.
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    try {
      final res = await dio.get<dynamic>(path, queryParameters: query);
      final body = res.data;
      return body is List ? body.whereType<Map<String, dynamic>>().toList() : const [];
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }

  Future<void> delete(String path) => _send(() => dio.delete<dynamic>(path));

  /// The current access token, for screens that must pass it to a web view (printable invoices).
  Future<String?> accessToken() async => (await tokens.read())?.accessToken;

  Future<Map<String, dynamic>> post(String path, {Object? data, bool auth = true}) =>
      _send(() => dio.post<dynamic>(path, data: data, options: Options(extra: {_skipAuth: !auth})));

  Future<Map<String, dynamic>> patch(String path, {Object? data}) =>
      _send(() => dio.patch<dynamic>(path, data: data));

  Future<Map<String, dynamic>> put(String path, {Object? data}) => _send(() => dio.put<dynamic>(path, data: data));

  /// Multipart upload. [onProgress] receives 0..1 as the file is sent.
  Future<Map<String, dynamic>> upload(String path, FormData form, {void Function(double)? onProgress}) => _send(
        () => dio.post<dynamic>(
          path,
          data: form,
          options: Options(sendTimeout: const Duration(minutes: 2)),
          onSendProgress: (sent, total) {
            if (onProgress != null && total > 0) onProgress(sent / total);
          },
        ),
      );

  Future<Map<String, dynamic>> _send(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final body = res.data;
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }

  Future<void> _onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    options.headers['Accept-Language'] = language();
    if (options.extra[_skipAuth] != true) {
      final stored = await tokens.read();
      if (stored != null) options.headers['Authorization'] = 'Bearer ${stored.accessToken}';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final req = err.requestOptions;
    final code = _errorCode(err.response?.data);
    final expired = err.response?.statusCode == 401 && code == 'AUTH_TOKEN_INVALID';
    if (!expired || req.extra[_skipAuth] == true || req.extra[_retried] == true) {
      return handler.next(err);
    }

    final stored = await tokens.read();
    if (stored == null) return handler.next(err);

    // Another queued request may already have refreshed while this one waited.
    final sentWith = (req.headers['Authorization'] as String?)?.replaceFirst('Bearer ', '');
    var access = stored.accessToken;
    if (sentWith == stored.accessToken) {
      try {
        final res = await _plain.post<dynamic>(
          '/v1/auth/refresh',
          data: {'refreshToken': stored.refreshToken},
          options: Options(headers: {'Accept-Language': language()}),
        );
        final body = res.data as Map<String, dynamic>;
        access = body['accessToken'] as String;
        await tokens.save(access, body['refreshToken'] as String);
      } on DioException {
        await tokens.clear();
        onSessionEnded?.call();
        return handler.next(err);
      }
    }

    try {
      req.headers['Authorization'] = 'Bearer $access';
      req.extra[_retried] = true;
      // A multipart body can be sent only once; retry with a fresh copy.
      if (req.data is FormData) req.data = (req.data as FormData).clone();
      handler.resolve(await _plain.fetch<dynamic>(req));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  static String? _errorCode(Object? data) {
    if (data is Map && data['error'] is Map) return (data['error'] as Map)['code']?.toString();
    return null;
  }
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  return ApiClient(
    baseUrl: config.apiUrl,
    tokens: ref.watch(tokenStoreProvider),
    language: () => ref.read(languageProvider).languageCode,
  );
});
