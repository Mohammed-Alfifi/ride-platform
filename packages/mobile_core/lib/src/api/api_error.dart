import 'package:dio/dio.dart';

/// An error from the API, carrying its stable code and a message already localised by the server.
class ApiError implements Exception {
  const ApiError({required this.code, required this.message, this.status});

  final String code;
  final String message;
  final int? status;

  bool get isNetwork => code == 'NETWORK';
  bool get isSessionEnded =>
      code == 'AUTH_TOKEN_INVALID' || code == 'AUTH_REFRESH_INVALID' || code == 'AUTH_REFRESH_REUSED';

  /// Turns any Dio failure into an [ApiError]. Server bodies look like
  /// { "error": { "code": "...", "message": "..." } }.
  factory ApiError.fromDio(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map;
      return ApiError(
        code: (err['code'] ?? 'INTERNAL').toString(),
        message: (err['message'] ?? '').toString(),
        status: e.response?.statusCode,
      );
    }
    if (e.response == null) {
      return const ApiError(code: 'NETWORK', message: '');
    }
    return ApiError(code: 'INTERNAL', message: '', status: e.response?.statusCode);
  }

  @override
  String toString() => 'ApiError($code, $status): $message';
}
