class UserProfile {
  const UserProfile({
    required this.id,
    required this.phone,
    required this.role,
    required this.status,
    required this.locale,
    this.name,
    this.partnerId,
    this.termsVersion,
  });

  final String id;
  final String phone;
  final String? name;
  final String role;
  final String status;
  final String locale;
  final String? partnerId;

  /// The terms version the user accepted; null until they accept any.
  final String? termsVersion;

  bool get isPending => status == 'pending';
  bool get needsName => name == null || name!.trim().isEmpty;

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        phone: json['phone'] as String,
        name: json['name'] as String?,
        role: json['role'] as String,
        status: json['status'] as String,
        locale: (json['locale'] as String?) ?? 'ar',
        partnerId: json['partnerId'] as String?,
        termsVersion: json['termsVersion'] as String?,
      );
}
