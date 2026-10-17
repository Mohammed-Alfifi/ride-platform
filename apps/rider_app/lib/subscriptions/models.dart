/// Rider-side views of the API's subscription, payment and invoice resources.
library;

int _int(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
double _double(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
String? _str(Object? v) => v?.toString();

class Place {
  const Place({required this.id, required this.label, required this.name, required this.lat, required this.lng, this.address});

  factory Place.fromJson(Map<String, dynamic> j) => Place(
        id: j['id'] as String,
        label: j['label'] as String,
        name: j['name'] as String,
        lat: _double(j['lat']),
        lng: _double(j['lng']),
        address: _str(j['address']),
      );

  final String id;
  final String label; // home | school | work | other
  final String name;
  final double lat;
  final double lng;
  final String? address;
}

class Plan {
  const Plan({
    required this.id,
    required this.nameAr,
    required this.nameEn,
    required this.tripType,
    required this.daysPerWeek,
    required this.priceHalalas,
    required this.maxDistanceKm,
  });

  factory Plan.fromJson(Map<String, dynamic> j) => Plan(
        id: j['id'] as String,
        nameAr: j['nameAr'] as String,
        nameEn: j['nameEn'] as String,
        tripType: j['tripType'] as String,
        daysPerWeek: _int(j['daysPerWeek']),
        priceHalalas: _int(j['priceHalalas']),
        maxDistanceKm: _int(j['maxDistanceKm']),
      );

  final String id;
  final String nameAr;
  final String nameEn;
  final String tripType; // round_trip | one_way
  final int daysPerWeek;
  final int priceHalalas;
  final int maxDistanceKm;

  bool get roundTrip => tripType == 'round_trip';
  String name(bool ar) => ar ? nameAr : nameEn;
}

/// A partner serving the pick-up point, with the plans it offers there.
class Coverage {
  const Coverage({required this.partnerNameAr, required this.partnerNameEn, required this.zoneNameAr, required this.zoneNameEn, required this.plans});

  factory Coverage.fromJson(Map<String, dynamic> j) => Coverage(
        partnerNameAr: j['partnerNameAr'] as String,
        partnerNameEn: j['partnerNameEn'] as String,
        zoneNameAr: j['zoneNameAr'] as String,
        zoneNameEn: j['zoneNameEn'] as String,
        plans: (j['plans'] as List? ?? const []).cast<Map<String, dynamic>>().map(Plan.fromJson).toList(),
      );

  final String partnerNameAr;
  final String partnerNameEn;
  final String zoneNameAr;
  final String zoneNameEn;
  final List<Plan> plans;

  String partner(bool ar) => ar ? partnerNameAr : partnerNameEn;
}

class Quote {
  const Quote({
    required this.eligible,
    required this.reason,
    required this.distanceKm,
    required this.maxDistanceKm,
    required this.priceHalalas,
    required this.vatHalalas,
  });

  factory Quote.fromJson(Map<String, dynamic> j) => Quote(
        eligible: j['eligible'] == true,
        reason: _str(j['reason']),
        distanceKm: _int(j['distanceKm']),
        maxDistanceKm: _int(j['maxDistanceKm']),
        priceHalalas: _int(j['priceHalalas']),
        vatHalalas: _int(j['vatHalalas']),
      );

  final bool eligible;
  final String? reason;
  final int distanceKm;
  final int maxDistanceKm;
  final int priceHalalas;
  final int vatHalalas;
}

class SavedCard {
  const SavedCard({required this.id, required this.brand, required this.last4, this.expMonth, this.expYear});

  factory SavedCard.fromJson(Map<String, dynamic> j) => SavedCard(
        id: j['id'] as String,
        brand: j['brand'] as String,
        last4: j['last4'] as String,
        expMonth: j['expMonth'] == null ? null : _int(j['expMonth']),
        expYear: j['expYear'] == null ? null : _int(j['expYear']),
      );

  final String id;
  final String brand;
  final String last4;
  final int? expMonth;
  final int? expYear;
}

class Subscription {
  const Subscription({
    required this.id,
    required this.status,
    required this.planNameAr,
    required this.planNameEn,
    required this.partnerNameAr,
    required this.partnerNameEn,
    required this.pickup,
    required this.dropoff,
    required this.days,
    required this.outboundTime,
    required this.returnTime,
    required this.priceHalalas,
    required this.currentPeriodStart,
    required this.currentPeriodEnd,
    required this.autoRenew,
    required this.cancelAtPeriodEnd,
    required this.pausedFrom,
    required this.pausedUntil,
    required this.card,
    required this.payUrl,
    required this.pendingPaymentId,
  });

  factory Subscription.fromJson(Map<String, dynamic> j) => Subscription(
        id: j['id'] as String,
        status: j['status'] as String,
        planNameAr: j['planNameAr'] as String,
        planNameEn: j['planNameEn'] as String,
        partnerNameAr: j['partnerNameAr'] as String,
        partnerNameEn: j['partnerNameEn'] as String,
        pickup: Place.fromJson(j['pickup'] as Map<String, dynamic>),
        dropoff: Place.fromJson(j['dropoff'] as Map<String, dynamic>),
        days: (j['days'] as List).map(_int).toList(),
        outboundTime: j['outboundTime'] as String,
        returnTime: _str(j['returnTime']),
        priceHalalas: _int(j['priceHalalas']),
        currentPeriodStart: _str(j['currentPeriodStart']),
        currentPeriodEnd: _str(j['currentPeriodEnd']),
        autoRenew: j['autoRenew'] == true,
        cancelAtPeriodEnd: j['cancelAtPeriodEnd'] == true,
        pausedFrom: _str(j['pausedFrom']),
        pausedUntil: _str(j['pausedUntil']),
        card: j['card'] is Map<String, dynamic>
            ? SavedCard.fromJson({...j['card'] as Map<String, dynamic>, 'expMonth': null, 'expYear': null})
            : null,
        payUrl: _str(j['payUrl']),
        pendingPaymentId: _str(j['pendingPaymentId']),
      );

  final String id;
  final String status; // pending_payment | active | past_due | paused | cancelled | expired
  final String planNameAr;
  final String planNameEn;
  final String partnerNameAr;
  final String partnerNameEn;
  final Place pickup;
  final Place dropoff;
  final List<int> days;
  final String outboundTime;
  final String? returnTime;
  final int priceHalalas;
  final String? currentPeriodStart;
  final String? currentPeriodEnd;
  final bool autoRenew;
  final bool cancelAtPeriodEnd;
  final String? pausedFrom;
  final String? pausedUntil;
  final SavedCard? card;
  final String? payUrl;
  final String? pendingPaymentId;

  bool get live => status == 'active' || status == 'past_due';
  bool get needsPayment => status == 'pending_payment' || status == 'past_due';

  /// A pause that has not ended yet (it may start in the future).
  bool pauseOpen(String today) => pausedUntil != null && pausedUntil!.compareTo(today) >= 0;
}

class Payment {
  const Payment({required this.id, required this.status, required this.checkoutUrl, required this.failureReason, required this.invoiceId});

  factory Payment.fromJson(Map<String, dynamic> j) => Payment(
        id: j['id'] as String,
        status: j['status'] as String,
        checkoutUrl: _str(j['checkoutUrl']),
        failureReason: _str(j['failureReason']),
        invoiceId: _str(j['invoiceId']),
      );

  final String id;
  final String status; // initiated | paid | failed
  final String? checkoutUrl;
  final String? failureReason;
  final String? invoiceId;
}

class Invoice {
  const Invoice({required this.id, required this.number, required this.issuedAt, required this.description, required this.totalHalalas, required this.vatHalalas, required this.taxInvoice});

  factory Invoice.fromJson(Map<String, dynamic> j) => Invoice(
        id: j['id'] as String,
        number: j['number'] as String,
        issuedAt: j['issuedAt'] as String,
        description: j['description'] as String,
        totalHalalas: _int(j['totalHalalas']),
        vatHalalas: _int(j['vatHalalas']),
        taxInvoice: j['kind'] == 'simplified_tax_invoice',
      );

  final String id;
  final String number;
  final String issuedAt;
  final String description;
  final int totalHalalas;
  final int vatHalalas;
  final bool taxInvoice;
}
