/// A trip as the driver sees it.
class Spot {
  const Spot(this.lat, this.lng, this.name);
  factory Spot.fromJson(Map<String, dynamic> j) => Spot((j['lat'] as num).toDouble(), (j['lng'] as num).toDouble(), j['name'] as String);
  final double lat;
  final double lng;
  final String name;
}

class DriverTrip {
  const DriverTrip({
    required this.id,
    required this.leg,
    required this.scheduledAt,
    required this.status,
    required this.pickup,
    required this.dropoff,
    required this.riderName,
    required this.riderPhone,
    this.passengerName,
    this.arrivedAt,
  });

  factory DriverTrip.fromJson(Map<String, dynamic> j) {
    final rider = j['rider'] as Map<String, dynamic>;
    return DriverTrip(
      id: j['id'] as String,
      leg: j['leg'] as String,
      scheduledAt: DateTime.parse(j['scheduledAt'] as String),
      status: j['status'] as String,
      pickup: Spot.fromJson(j['pickup'] as Map<String, dynamic>),
      dropoff: Spot.fromJson(j['dropoff'] as Map<String, dynamic>),
      riderName: rider['name'] as String?,
      riderPhone: rider['phone'] as String,
      passengerName: j['passengerName'] as String?,
      arrivedAt: j['arrivedAt'] == null ? null : DateTime.parse(j['arrivedAt'] as String),
    );
  }

  final String id;
  final String leg; // outbound | return
  final DateTime scheduledAt;
  final String status; // scheduled | en_route | arrived | on_board | completed | no_show | skipped | cancelled
  final Spot pickup;
  final Spot dropoff;
  final String? riderName;
  final String riderPhone;

  /// Who actually rides: a family member (a son, a daughter) or the account holder.
  final String? passengerName;

  String get displayName => passengerName ?? riderName ?? riderPhone;
  final DateTime? arrivedAt;

  bool get active => status == 'en_route' || status == 'arrived' || status == 'on_board';
  bool get open => status == 'scheduled' || active;

  /// Where the driver is heading now.
  Spot get target => status == 'on_board' ? dropoff : pickup;
}
