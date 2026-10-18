import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';

/// How the server runs (GET /v1/app-config): sign-in method, payment mode, links and support.
class ServerConfig {
  const ServerConfig({
    required this.signIn,
    required this.paymentMode,
    required this.paymentInstructionsAr,
    required this.paymentInstructionsEn,
    required this.supportWhatsapp,
    required this.termsVersion,
    required this.termsUrl,
    required this.privacyUrl,
    required this.emergencyNumber,
  });

  /// sms or access_code.
  final String signIn;

  /// online (payment page) or manual (bank transfer or cash, recorded by the team).
  final String paymentMode;
  final String paymentInstructionsAr;
  final String paymentInstructionsEn;

  /// E.164, or null when the team has not set one.
  final String? supportWhatsapp;
  final String termsVersion;
  final String termsUrl;
  final String privacyUrl;
  final String emergencyNumber;

  bool get manualPayments => paymentMode == 'manual';

  String paymentInstructions(bool ar) => ar ? paymentInstructionsAr : paymentInstructionsEn;

  /// A WhatsApp chat with support, with the message typed in.
  Uri? whatsapp([String text = '']) {
    final phone = supportWhatsapp;
    if (phone == null || phone.isEmpty) return null;
    return Uri.parse('https://wa.me/${phone.replaceAll('+', '')}${text.isEmpty ? '' : '?text=${Uri.encodeComponent(text)}'}');
  }

  factory ServerConfig.fromJson(Map<String, dynamic> j) {
    final links = (j['links'] as Map?)?.cast<String, dynamic>() ?? const {};
    final pay = (j['paymentInstructions'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ServerConfig(
      signIn: (j['signIn'] as String?) ?? 'sms',
      paymentMode: (j['paymentMode'] as String?) ?? 'online',
      paymentInstructionsAr: (pay['ar'] as String?) ?? '',
      paymentInstructionsEn: (pay['en'] as String?) ?? '',
      supportWhatsapp: j['supportWhatsapp'] as String?,
      termsVersion: (j['termsVersion'] as String?) ?? '',
      termsUrl: (links['terms'] as String?) ?? '',
      privacyUrl: (links['privacy'] as String?) ?? '',
      emergencyNumber: (j['emergencyNumber'] as String?) ?? '911',
    );
  }
}

/// Loaded once after sign-in. Tests override it with a fixed value.
final serverConfigProvider = FutureProvider<ServerConfig>((ref) async {
  final body = await ref.watch(apiClientProvider).get('/v1/app-config');
  return ServerConfig.fromJson(body);
});
