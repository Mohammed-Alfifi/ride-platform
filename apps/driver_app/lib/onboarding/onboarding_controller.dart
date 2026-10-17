import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'models.dart';

/// The driver's application, loaded from the API and updated after every step.
class OnboardingController extends AsyncNotifier<Onboarding> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<Onboarding> build() async => Onboarding.fromJson(await _api.get('/v1/driver/onboarding'));

  Future<void> refresh() async {
    state = await AsyncValue.guard(build);
  }

  Future<void> join(String code) => _apply(_api.post('/v1/driver/onboarding/join', data: {'code': code.trim()}));

  Future<void> saveDetails({
    required String fullName,
    required String nationalId,
    required String dateOfBirth,
  }) =>
      _apply(_api.put('/v1/driver/onboarding/profile', data: {
        'fullName': fullName.trim(),
        'nationalId': nationalId,
        'dateOfBirth': dateOfBirth,
        'saudiConfirmed': true,
      }));

  Future<void> saveVehicle(Map<String, Object> vehicle) => _apply(_api.put('/v1/driver/onboarding/vehicle', data: vehicle));

  Future<void> uploadDocument({
    required String type,
    required String filePath,
    required String fileName,
    String? expiresAt,
    void Function(double)? onProgress,
  }) async {
    final form = FormData.fromMap({
      'type': type,
      if (expiresAt != null) 'expiresAt': expiresAt,
      'file': await MultipartFile.fromFile(filePath, filename: fileName),
    });
    await _api.upload('/v1/driver/documents', form, onProgress: onProgress);
    await refresh();
  }

  Future<void> submit() => _apply(_api.post('/v1/driver/onboarding/submit'));

  Future<void> _apply(Future<Map<String, dynamic>> call) async {
    final body = await call; // errors propagate to the screen that asked
    state = AsyncData(Onboarding.fromJson(body));
  }
}

final onboardingProvider = AsyncNotifierProvider<OnboardingController, Onboarding>(OnboardingController.new);
