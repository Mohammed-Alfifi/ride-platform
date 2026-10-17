/// Document types, in the order the driver app asks for them.
const documentTypes = [
  'driver_photo',
  'national_id',
  'driving_license',
  'vehicle_registration',
  'vehicle_insurance',
  'periodic_inspection',
];

class PartnerSummary {
  const PartnerSummary({required this.id, required this.nameAr, required this.nameEn});
  final String id;
  final String nameAr;
  final String nameEn;

  factory PartnerSummary.fromJson(Map<String, dynamic> j) =>
      PartnerSummary(id: j['id'] as String, nameAr: j['nameAr'] as String, nameEn: j['nameEn'] as String);
}

class DriverDetails {
  const DriverDetails({this.fullName, this.nationalIdLast4, this.dateOfBirth, required this.saudiConfirmed});
  final String? fullName;
  final String? nationalIdLast4;
  final String? dateOfBirth;
  final bool saudiConfirmed;

  bool get complete => fullName != null && nationalIdLast4 != null && dateOfBirth != null && saudiConfirmed;

  factory DriverDetails.fromJson(Map<String, dynamic> j) => DriverDetails(
        fullName: j['fullName'] as String?,
        nationalIdLast4: j['nationalIdLast4'] as String?,
        dateOfBirth: j['dateOfBirth'] as String?,
        saudiConfirmed: j['saudiConfirmed'] == true,
      );
}

class VehicleInfo {
  const VehicleInfo({
    required this.plateLetters,
    required this.plateNumbers,
    required this.make,
    required this.model,
    required this.year,
    required this.color,
    required this.seats,
    required this.eligibleUntil,
  });
  final String plateLetters;
  final String plateNumbers;
  final String make;
  final String model;
  final int year;
  final String color;
  final int seats;
  final String eligibleUntil;

  factory VehicleInfo.fromJson(Map<String, dynamic> j) => VehicleInfo(
        plateLetters: j['plateLetters'] as String,
        plateNumbers: j['plateNumbers'] as String,
        make: j['make'] as String,
        model: j['model'] as String,
        year: (j['year'] as num).toInt(),
        color: j['color'] as String,
        seats: (j['seats'] as num).toInt(),
        eligibleUntil: j['eligibleUntil'] as String,
      );
}

class DriverDocument {
  const DriverDocument({
    required this.id,
    required this.type,
    required this.status,
    this.expiresAt,
    this.rejectionReason,
  });
  final String id;
  final String type;
  final String status; // pending | accepted | rejected
  final String? expiresAt;
  final String? rejectionReason;

  factory DriverDocument.fromJson(Map<String, dynamic> j) => DriverDocument(
        id: j['id'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        expiresAt: j['expiresAt'] as String?,
        rejectionReason: j['rejectionReason'] as String?,
      );
}

/// Mirrors GET /v1/driver/onboarding.
class Onboarding {
  const Onboarding({
    required this.status,
    required this.documents,
    required this.missing,
    required this.canSubmit,
    required this.complianceHold,
    this.partner,
    this.details,
    this.vehicle,
    this.rejectionReason,
    this.complianceReason,
  });

  final String status; // not_joined | draft | submitted | approved | rejected
  final PartnerSummary? partner;
  final DriverDetails? details;
  final VehicleInfo? vehicle;
  final List<DriverDocument> documents;
  final List<String> missing;
  final bool canSubmit;
  final String? rejectionReason;
  final bool complianceHold;
  final String? complianceReason;

  bool get editable => status == 'draft' || status == 'rejected';
  DriverDocument? document(String type) {
    for (final d in documents) {
      if (d.type == type) return d;
    }
    return null;
  }

  factory Onboarding.fromJson(Map<String, dynamic> j) => Onboarding(
        status: j['status'] as String,
        partner: j['partner'] == null ? null : PartnerSummary.fromJson(j['partner'] as Map<String, dynamic>),
        details: j['profile'] == null ? null : DriverDetails.fromJson(j['profile'] as Map<String, dynamic>),
        vehicle: j['vehicle'] == null ? null : VehicleInfo.fromJson(j['vehicle'] as Map<String, dynamic>),
        documents: (j['documents'] as List<dynamic>)
            .map((e) => DriverDocument.fromJson(e as Map<String, dynamic>))
            .toList(),
        missing: (j['missing'] as List<dynamic>).cast<String>(),
        canSubmit: j['canSubmit'] == true,
        rejectionReason: j['rejectionReason'] as String?,
        complianceHold: j['complianceHold'] == true,
        complianceReason: j['complianceReason'] as String?,
      );
}

/// Same check digit rule the server uses for Saudi national IDs.
bool isValidSaudiNationalId(String id) {
  if (!RegExp(r'^1\d{9}$').hasMatch(id)) return false;
  var sum = 0;
  for (var i = 0; i < 10; i++) {
    final digit = int.parse(id[i]);
    if (i.isEven) {
      final doubled = digit * 2;
      sum += doubled ~/ 10 + doubled % 10;
    } else {
      sum += digit;
    }
  }
  return sum % 10 == 0;
}
