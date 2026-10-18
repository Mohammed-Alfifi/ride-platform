import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;

/// Rider app copy in Arabic (default) and English.
class RiderStrings {
  const RiderStrings(this.ar);
  final bool ar;

  static RiderStrings of(BuildContext context) => RiderStrings(Localizations.localeOf(context).languageCode != 'en');

  String _s(String a, String e) => ar ? a : e;

  // Home
  String get welcome => _s('أهلا بك', 'Welcome');
  String get greeting => _s('مرحبا', 'Hello');
  String hello(String name) => _s('مرحبا، $name', 'Hello, $name');
  String get noSubscriptionTitle => _s('لا يوجد اشتراك بعد', 'No subscription yet');
  String get noSubscriptionBody => _s(
        'اختر مكان الذهاب والعودة وأيام الأسبوع، ونرتب لك سائقا ثابتا يصل في موعده.',
        'Pick your pick-up and drop-off and your days of the week, and get a regular driver who arrives on time.',
      );
  String get startSubscription => _s('اشترك الآن', 'Subscribe now');
  String get addSubscription => _s('اشتراك جديد', 'New subscription');
  String get invoicesAndCards => _s('الفواتير والبطاقات', 'Invoices and cards');
  String get myPlaces => _s('أماكني', 'My places');

  // Places
  String get placeLabelHome => _s('البيت', 'Home');
  String get placeLabelSchool => _s('المدرسة', 'School');
  String get placeLabelWork => _s('العمل', 'Work');
  String get placeLabelOther => _s('مكان آخر', 'Other');
  String placeLabel(String label) => switch (label) {
        'home' => placeLabelHome,
        'school' => placeLabelSchool,
        'work' => placeLabelWork,
        _ => placeLabelOther,
      };
  String get addPlace => _s('إضافة مكان', 'Add a place');
  String get moveMapHint => _s('حرّك الخريطة حتى يقع الدبوس على المدخل', 'Move the map until the pin is on the entrance');
  String get placeName => _s('اسم المكان', 'Place name');
  String get placeNameHint => _s('مثل: بيت الوالد، مدرسة الأندلس', 'e.g. Grandma\'s house, Al Andalus school');
  String get savePlace => _s('حفظ المكان', 'Save place');
  String get myLocation => _s('موقعي', 'My location');

  // New subscription
  String get stepRoute => _s('من وإلى', 'From and to');
  String get stepPlan => _s('الباقة', 'Plan');
  String get stepSchedule => _s('الأيام والمواعيد', 'Days and times');
  String get stepReview => _s('المراجعة والدفع', 'Review and pay');
  String get pickup => _s('مكان الركوب', 'Pick-up');
  String get dropoff => _s('الوجهة', 'Drop-off');
  String get choosePlace => _s('اختر مكانا', 'Choose a place');
  String get samePlace => _s('اختر مكانين مختلفين للركوب والوجهة.', 'Choose two different places for pick-up and drop-off.');
  String get next => _s('التالي', 'Next');
  String get noCoverage => _s(
        'لا تتوفر الخدمة عند مكان الركوب حاليا. نتوسع حيا بعد حي، وسنخبرك عند وصولنا.',
        'We do not serve this pick-up point yet. We grow one neighbourhood at a time and will let you know.',
      );
  String perMonth(String price) => _s('$price ريال شهريا', 'SAR $price / month');
  String daysPerWeek(int n) => _s('$n أيام في الأسبوع', '$n days a week');
  String get roundTrip => _s('ذهاب وعودة', 'Round trip');
  String get oneWay => _s('ذهاب فقط', 'One way');
  String upToKm(int km) => _s('حتى $km كم', 'Up to $km km');
  String distanceTooFar(int d, int max) => _s(
        'المسافة التقريبية $d كم، وهذه الباقة تغطي حتى $max كم. اختر باقة أخرى أو وجهة أقرب.',
        'The distance is about $d km and this plan covers up to $max km. Choose another plan or a closer drop-off.',
      );
  String get outsideZone => _s('مكان الركوب خارج نطاق هذه الباقة.', 'The pick-up is outside this plan\'s area.');
  String chooseDays(int n) => _s('اختر $n أيام', 'Choose $n days');
  List<String> get weekDays => ar
      ? const ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
      : const ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  String get outboundTime => _s('وقت الذهاب', 'Pick-up time');
  String get returnTime => _s('وقت العودة', 'Return time');
  String get returnAfterOutbound => _s('وقت العودة يجب أن يكون بعد وقت الذهاب.', 'The return time must be after the pick-up time.');
  String get serviceHours => _s('الخدمة من 5:00 صباحا حتى 10:00 مساء.', 'Service runs from 5:00 to 22:00.');
  String get distance => _s('المسافة التقريبية', 'Approximate distance');
  String km(int n) => _s('$n كم', '$n km');
  String get monthlyTotal => _s('الإجمالي الشهري', 'Monthly total');
  String vatIncluded(String vat) => _s('يشمل ضريبة القيمة المضافة $vat ريال', 'Includes VAT of SAR $vat');
  String get saveCard => _s('احفظ البطاقة للتجديد التلقائي كل شهر', 'Save my card to renew automatically each month');
  String get saveCardHint => _s(
        'نخصم في آخر يوم من الشهر فقط، ويمكنك الإلغاء أو حذف البطاقة متى شئت.',
        'We charge only on the last day of each month. Cancel or remove the card any time.',
      );
  String get payWith => _s('ادفع بمدى أو البطاقة أو Apple Pay أو STC Pay', 'Pay with mada, card, Apple Pay or STC Pay');
  String payAmount(String price) => _s('ادفع $price ريال', 'Pay SAR $price');
  String get startsTomorrow => _s('يبدأ الاشتراك من الغد بعد الدفع.', 'Your subscription starts tomorrow after payment.');

  // Checkout
  String get securePayment => _s('دفع آمن', 'Secure payment');
  String get confirming => _s('جار تأكيد الدفع…', 'Confirming your payment…');
  String get paid => _s('تم الدفع، اشتراكك فعّال', 'Paid. Your subscription is active');
  String get paymentFailed => _s('لم يتم الدفع. لم يُخصم أي مبلغ، ويمكنك المحاولة مرة أخرى.', 'The payment did not go through. Nothing was charged; you can try again.');
  String get paymentPending => _s(
        'لم يصلنا تأكيد الدفع بعد. سيتحدث الاشتراك تلقائيا عند وصوله.',
        'We have not received the payment confirmation yet. Your subscription updates as soon as it arrives.',
      );

  // Subscription
  String status(String s) => switch (s) {
        'pending_payment' => _s('بانتظار الدفع', 'Awaiting payment'),
        'active' => _s('فعّال', 'Active'),
        'past_due' => _s('بانتظار التجديد', 'Renewal due'),
        'paused' => _s('موقوف مؤقتا', 'Paused'),
        'cancelled' => _s('ملغى', 'Cancelled'),
        'expired' => _s('منتهي', 'Ended'),
        _ => s,
      };
  String paidUntil(String date) => _s('مدفوع حتى $date', 'Paid until $date');
  String renewsOn(String date) => _s('يتجدد تلقائيا في $date', 'Renews automatically on $date');
  String endsOn(String date) => _s('ينتهي في $date ولن يتجدد', 'Ends on $date and will not renew');
  String get pastDueBody => _s(
        'لم ننجح في خصم التجديد. ادفع خلال 3 أيام ليستمر سائقك دون انقطاع.',
        'We could not charge your renewal. Pay within 3 days to keep your rides going.',
      );
  String get pendingBody => _s('أكمل الدفع لتفعيل الاشتراك.', 'Complete the payment to start your subscription.');
  String get payNow => _s('ادفع الآن', 'Pay now');
  String get webPayWait => _s('فتحنا صفحة الدفع في نافذة جديدة. بعد إتمام الدفع ارجع هنا واضغط «أكملت الدفع».',
      'The payment page opened in a new tab. When you have paid, come back and tap "I have paid".');
  String get webPayDone => _s('أكملت الدفع', 'I have paid');
  String get manualPayTitle => _s('طريقة الدفع', 'How to pay');
  String subscribeManual(String amount) => _s('تأكيد الاشتراك ($amount)', 'Confirm subscription ($amount)');
  String get payManualHint => _s('الدفع بالتحويل البنكي أو نقدا بعد التأكيد. لا يُطلب منك أي دفع داخل التطبيق.',
      'Pay by bank transfer or cash after we confirm. Nothing is charged in the app.');
  String get sendReceipt => _s('أرسل إيصال التحويل بالواتساب', 'Send the transfer receipt on WhatsApp');
  String receiptMessage(String who, String plan, String amount, String ref) => _s(
      'السلام عليكم، أرسل إيصال التحويل لاشتراك مشوار.\nالاسم: $who\nالباقة: $plan\nالمبلغ: $amount\nرقم الاشتراك: $ref',
      'Hello, here is the transfer receipt for my Mishwar subscription.\nName: $who\nPlan: $plan\nAmount: $amount\nSubscription: $ref');
  String get manualPending => _s('بانتظار تأكيد الدفع من فريق مشوار.', 'Waiting for the Mishwar team to confirm your payment.');
  String pausedRange(String from, String until) => _s('موقوف من $from إلى $until', 'Paused from $from to $until');
  String get pause => _s('إيقاف مؤقت', 'Pause');
  String get pauseHelp => _s(
        'سفر أو إجازة؟ أوقف الاشتراك حتى 30 يوما مرة في الشهر، وتُضاف الأيام إلى نهاية اشتراكك.',
        'Travelling or on holiday? Pause for up to 30 days once a month; the days are added to the end of your subscription.',
      );
  String get resume => _s('استئناف الآن', 'Resume now');
  String get cancel => _s('إلغاء التجديد', 'Stop renewing');
  String get cancelConfirm => _s(
        'سيستمر اشتراكك حتى نهاية الفترة المدفوعة ثم يتوقف. هل تريد المتابعة؟',
        'Your subscription continues to the end of the paid period, then stops. Continue?',
      );
  String get cancelPending => _s('إلغاء الاشتراك', 'Cancel subscription');
  String get keep => _s('متابعة الاشتراك', 'Keep subscription');
  String get back => _s('رجوع', 'Back');
  String get confirm => _s('تأكيد', 'Confirm');
  String get schedule => _s('الجدول', 'Schedule');
  String get renewalCard => _s('بطاقة التجديد', 'Renewal card');
  String get noCard => _s('لا توجد بطاقة محفوظة، سنرسل لك رابط دفع عند التجديد.', 'No saved card; we will send you a payment link at renewal.');
  String get serviceBy => _s('مقدم الخدمة', 'Provided by');

  // Billing
  String get invoices => _s('الفواتير', 'Invoices');
  String get noInvoices => _s('ستظهر فواتيرك هنا بعد أول دفعة.', 'Your invoices appear here after your first payment.');
  String get cards => _s('البطاقات المحفوظة', 'Saved cards');
  String get noCards => _s('لا توجد بطاقات محفوظة.', 'No saved cards.');
  String get removeCard => _s('حذف البطاقة', 'Remove card');
  String get removeCardConfirm => _s(
        'لن نستطيع تجديد اشتراكك تلقائيا بهذه البطاقة، وسنرسل لك رابط دفع بدلا منها.',
        'We will not be able to renew with this card; we will send you a payment link instead.',
      );
  String get taxInvoice => _s('فاتورة ضريبية مبسطة', 'Simplified tax invoice');
  String get receipt => _s('إيصال', 'Receipt');
  String expires(int m, int y) => _s('تنتهي ${m.toString().padLeft(2, '0')}/${y % 100}', 'Expires ${m.toString().padLeft(2, '0')}/${y % 100}');

  // Family and codes
  String get whoRides => _s('من سيركب؟', 'Who is riding?');
  String get whoRidesHint => _s('اختر ابنك أو ابنتك إن كان الاشتراك لهم', 'Choose your child if the subscription is for them');
  String get me => _s('أنا', 'Me');
  String get addFamily => _s('إضافة فرد من العائلة', 'Add a family member');
  String get memberName => _s('الاسم', 'Name');
  String get memberNote => _s('المدرسة أو الصف (اختياري)', 'School or class (optional)');
  String get memberNoteHint => _s('يساعد السائق عند البوابة', 'Helps the driver at the gate');
  String relation(String r) => switch (r) {
        'child' => _s('ابن أو ابنة', 'Child'),
        'spouse' => _s('زوج أو زوجة', 'Spouse'),
        'parent' => _s('أب أو أم', 'Parent'),
        _ => _s('آخر', 'Other'),
      };
  String get promoCode => _s('كود الخصم', 'Discount code');
  String get apply => _s('تطبيق', 'Apply');
  String promoApplied(String code, String amount) =>
      _s('تم تطبيق $code: خصم $amount ريال على الشهر الأول', '$code applied: SAR $amount off the first month');

  // Trips
  String get nextTrip => _s('رحلتك القادمة', 'Your next trip');
  String get tripNow => _s('رحلتك الآن', 'Your trip now');
  String get follow => _s('تابع السائق', 'Follow your driver');
  String get upcomingTrips => _s('الرحلات القادمة', 'Upcoming trips');
  String get noUpcoming => _s('ستظهر رحلاتك هنا قبل موعدها بيوم.', 'Your trips appear here a day ahead.');
  String get skipTrip => _s('لا أحتاج هذه الرحلة', "I don't need this trip");
  String get skipConfirm => _s('سنبلغ السائق ألا يأتي لهذه الرحلة فقط. بقية الرحلات كما هي.', 'We will tell the driver not to come for this trip only. Other trips stay as they are.');
  String get skipped => _s('تم إبلاغ السائق', 'Your driver has been told');
  String get outbound => _s('ذهاب', 'Outbound');
  String get returnLeg => _s('عودة', 'Return');
  String get today => _s('اليوم', 'Today');
  String get tomorrow => _s('غدا', 'Tomorrow');
  String tripScheduled(String time) => _s('رحلتك الساعة $time', 'Your trip is at $time');
  String get tripScheduledBody => _s('سنرسل لك إشعارا عندما يتحرك السائق إليك.', 'We will notify you when your driver sets off.');
  String get driverOnWay => _s('السائق في الطريق', 'Your driver is on the way');
  String arrivesIn(int m) => _s('يصل خلال $m دقيقة', 'Arrives in $m min');
  String get getReady => _s('استعد عند مكان الركوب.', 'Get ready at the pick-up point.');
  String get driverArrived => _s('السائق وصل', 'Your driver is here');
  String driverWaiting(String place) => _s('ينتظرك عند $place', 'Waiting at $place');
  String reachIn(int m) => _s('الوصول خلال $m دقيقة', 'Arriving in $m min');
  String onTheWayTo(String place) => _s('في الطريق إلى $place', 'On the way to $place');
  String get arrivedSafely => _s('وصل بالسلامة', 'Arrived safely');
  String arrivedAt(String place) => _s('تم الوصول إلى $place', 'Arrived at $place');
  String get expectedArrival => _s('الوصول المتوقع', 'Expected');
  String get shareTrip => _s('شارك الرحلة', 'Share trip');
  String shareMessage(String who, String url) => who.isEmpty
      ? _s('تابع مشواري مباشرة على الخريطة: $url', 'Follow my ride live on the map: $url')
      : _s('تابع مشوار $who مباشرة على الخريطة: $url', 'Follow $who\'s ride live on the map: $url');
  String get rateTitle => _s('كيف كانت الرحلة؟', 'How was the ride?');
  String get rateThanks => _s('شكرا، وصل تقييمك', 'Thanks for your rating');
  String get rateComment => _s('ملاحظة للشريك (اختياري)', 'A note for the operator (optional)');
  String get sendRating => _s('إرسال التقييم', 'Send rating');
  String ratingTag(String tag) => switch (tag) {
        'on_time' => _s('في الموعد', 'On time'),
        'safe_driving' => _s('قيادة آمنة', 'Safe driving'),
        'clean_car' => _s('سيارة نظيفة', 'Clean car'),
        'polite' => _s('تعامل راق', 'Polite'),
        'late' => _s('تأخر', 'Late'),
        'unsafe_driving' => _s('قيادة غير آمنة', 'Unsafe driving'),
        'unclean_car' => _s('سيارة غير نظيفة', 'Unclean car'),
        _ => _s('تعامل سيئ', 'Rude'),
      };
  String get help => _s('المساعدة', 'Help');
  String get yourDriver => _s('سائقك', 'Your driver');
  String get callDriver => _s('اتصل بالسائق', 'Call the driver');
  String get noDriverYet => _s('سيُحدد السائق قريبا', 'Driver to be confirmed');
  String get stepOnWay => _s('في الطريق', 'On the way');
  String get stepArrived => _s('وصل', 'Arrived');
  String get stepOnBoard => _s('ركبت', 'On board');
  String get stepDone => _s('وصلت', 'Dropped off');
  String tripStatus(String s) => switch (s) {
        'scheduled' => _s('مجدولة', 'Scheduled'),
        'en_route' => _s('السائق في الطريق', 'Driver on the way'),
        'arrived' => _s('السائق وصل', 'Driver arrived'),
        'on_board' => _s('في الطريق', 'On the way'),
        'completed' => _s('مكتملة', 'Completed'),
        'no_show' => _s('لم تحضر', 'Missed'),
        'skipped' => _s('ألغيتها', 'You cancelled'),
        _ => _s('ملغاة', 'Cancelled'),
      };

  String sar(int halalas) => NumberFormat.decimalPatternDigits(locale: 'en', decimalDigits: halalas % 100 == 0 ? 0 : 2).format(halalas / 100);

  String day(String iso) {
    final d = DateTime.parse('${iso.substring(0, 10)}T00:00:00');
    return DateFormat.yMMMd(ar ? 'ar' : 'en').format(d).replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x660}');
  }

  String daysList(List<int> days) => days.map((d) => weekDays[d]).join(ar ? '، ' : ', ');
}
