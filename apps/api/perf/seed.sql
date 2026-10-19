-- Performance test data, on top of `seed.js --demo` (demo partner, zone and plans).
-- A busy operator: 3 drivers, 1,500 subscribers, two months of history plus today and tomorrow,
-- GPS history for recent trips, and two payments per subscriber.
\set ON_ERROR_STOP on
CREATE TEMP TABLE p AS SELECT id FROM partners WHERE cr_number = '1010000001';
CREATE TEMP TABLE pl AS SELECT id, price_halalas FROM plans WHERE partner_id = (SELECT id FROM p) LIMIT 1;

INSERT INTO users (phone, audience, role, name, status, partner_id)
SELECT '+96650000' || (2000 + i), 'driver', 'driver', 'سائق ' || i, 'active', (SELECT id FROM p) FROM generate_series(1, 3) i;
INSERT INTO driver_profiles (user_id, partner_id, full_name, status)
SELECT id, partner_id, name, 'approved' FROM users WHERE phone LIKE '+966500002%' AND audience = 'driver';
INSERT INTO vehicles (driver_id, partner_id, plate_letters, plate_numbers, make, model, year, color, seats)
SELECT user_id, partner_id, 'ABJ', (1000 + row_number() OVER ())::text, 'Hyundai', 'Staria', extract(year FROM now())::int, 'أبيض', 8
FROM driver_profiles WHERE full_name LIKE 'سائق %';
CREATE TEMP TABLE drv AS SELECT user_id AS id, row_number() OVER () AS n FROM driver_profiles WHERE full_name LIKE 'سائق %';

INSERT INTO users (phone, audience, role, name, status)
SELECT '+96655999' || lpad(i::text, 4, '0'), 'rider', 'rider', 'راكب ' || i, 'active' FROM generate_series(1, 1500) i;
CREATE TEMP TABLE riders AS SELECT id, row_number() OVER () AS n FROM users WHERE phone LIKE '+96655999%';
INSERT INTO places (rider_id, label, name, location)
SELECT id, 'home', 'البيت', ST_SetSRID(ST_MakePoint(46.8275, 24.8675), 4326) FROM riders WHERE n = 1;
INSERT INTO places (rider_id, label, name, location)
SELECT id, 'school', 'المدرسة', ST_SetSRID(ST_MakePoint(46.831, 24.872), 4326) FROM riders WHERE n = 1;
CREATE TEMP TABLE pick AS SELECT id FROM places WHERE label = 'home' LIMIT 1;
CREATE TEMP TABLE drop AS SELECT id FROM places WHERE label = 'school' LIMIT 1;

INSERT INTO subscriptions (rider_id, partner_id, plan_id, pickup_place_id, dropoff_place_id, days, outbound_time, return_time,
  distance_km, price_halalas, status, current_period_start, current_period_end, driver_id)
SELECT r.id, (SELECT id FROM p), (SELECT id FROM pl), (SELECT id FROM pick), (SELECT id FROM drop), ARRAY[0,1,2,3,4,5,6],
  to_char(time '06:00' + (r.n % 90) * interval '1 minute', 'HH24:MI'),
  to_char(time '12:30' + (r.n % 150) * interval '1 minute', 'HH24:MI'),
  3, (SELECT price_halalas FROM pl), 'active', current_date - 20, current_date + 10,
  (SELECT id FROM drv WHERE drv.n = 1 + r.n % 3)
FROM riders r;

INSERT INTO trips (subscription_id, partner_id, rider_id, driver_id, service_date, leg, scheduled_at, pickup, pickup_name, dropoff, dropoff_name, status)
SELECT s.id, s.partner_id, s.rider_id, s.driver_id, d::date, l.leg,
  (d::date + (CASE WHEN l.leg = 'outbound' THEN s.outbound_time ELSE s.return_time END)::time) AT TIME ZONE 'Asia/Riyadh',
  ST_SetSRID(ST_MakePoint(46.8275, 24.8675), 4326), 'البيت', ST_SetSRID(ST_MakePoint(46.831, 24.872), 4326), 'المدرسة',
  CASE WHEN d::date < current_date THEN (CASE WHEN random() < 0.03 THEN 'no_show' ELSE 'completed' END)::trip_status ELSE 'scheduled' END
FROM subscriptions s
CROSS JOIN generate_series(current_date - 60, current_date + 1, interval '1 day') d
CROSS JOIN (VALUES ('outbound'::trip_leg), ('return'::trip_leg)) l(leg);

UPDATE trips SET started_at = scheduled_at - interval '20 minutes',
  arrived_at = scheduled_at + (random() * 12 - 4) * interval '1 minute',
  completed_at = scheduled_at + interval '25 minutes'
WHERE status IN ('completed', 'no_show');

INSERT INTO trip_points (trip_id, location, recorded_at)
SELECT t.id, ST_SetSRID(ST_MakePoint(46.82 + random() * 0.02, 24.86 + random() * 0.02), 4326), t.scheduled_at + g * interval '10 seconds'
FROM (SELECT id, scheduled_at FROM trips WHERE status = 'completed' ORDER BY scheduled_at DESC LIMIT 3000) t
CROSS JOIN generate_series(1, 100) g;

INSERT INTO payments (rider_id, partner_id, subscription_id, purpose, provider, amount_halalas, platform_fee_halalas, partner_share_halalas,
  status, period_start, paid_at, method, provider_payment_id)
SELECT s.rider_id, s.partner_id, s.id, CASE WHEN m = 0 THEN 'start' ELSE 'renewal' END::payment_purpose, 'manual', s.price_halalas,
  s.price_halalas / 10, s.price_halalas - s.price_halalas / 10, 'paid', current_date - 50 + m * 30,
  now() - (50 - m * 30) * interval '1 day', 'bank_transfer', 'perf_' || s.id || '_' || m
FROM subscriptions s CROSS JOIN generate_series(0, 1) m;

ANALYZE;
SELECT (SELECT count(*) FROM trips) AS trips, (SELECT count(*) FROM subscriptions) AS subscriptions,
  (SELECT count(*) FROM trip_points) AS gps_points, (SELECT count(*) FROM payments) AS payments;
