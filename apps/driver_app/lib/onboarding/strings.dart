import 'package:flutter/widgets.dart';

/// Strings for the driver onboarding flow (Arabic first, English second).
class OnboardingStrings {
  const OnboardingStrings._(this.ar);
  final bool ar;

  static OnboardingStrings of(BuildContext context) =>
      OnboardingStrings._(Localizations.localeOf(context).languageCode != 'en');

  String t(String arText, String enText) => ar ? arText : enText;

  String get title => t('طلب الانضمام', 'Your application');
  String get stepPartner => t('شركة النقل', 'Transport partner');
  String get stepDetails => t('بياناتك', 'Your details');
  String get stepVehicle => t('مركبتك', 'Your vehicle');
  String get stepDocuments => t('الوثائق', 'Documents');
  String get done => t('مكتمل', 'Done');
  String get todo => t('مطلوب', 'Needed');
  String get edit => t('تعديل', 'Edit');
  String get submit => t('إرسال الطلب للمراجعة', 'Send for review');
  String get submitted => t('تم إرسال طلبك', 'Application sent');
  String get submittedBody =>
      t('يراجع شريك النقل بياناتك ووثائقك. سيصلك إشعار بالنتيجة.', 'The transport partner is reviewing your details. You will be notified.');
  String get rejectedTitle => t('طلبك يحتاج تعديلا', 'Your application needs changes');
  String get approvedTitle => t('تم اعتمادك', 'You are approved');
  String get approvedBody =>
      t('ستظهر مساراتك هنا عند إسنادها لك.', 'Your routes will appear here once assigned.');
  String get holdTitle => t('استلام الرحلات متوقف مؤقتا', 'Trips paused');
  String get holdBody =>
      t('إحدى وثائقك منتهية. ارفع النسخة المجددة ليعاد تفعيلك بعد قبولها.', 'One of your documents has expired. Upload the renewed one to resume once accepted.');

  // Join
  String get joinTitle => t('أدخل رمز شركة النقل', 'Enter the partner code');
  String get joinBody => t('احصل على الرمز من شركة النقل المرخّصة التي ستعمل معها.', 'Get the code from the licensed transport company you will drive with.');
  String get joinCode => t('رمز الانضمام', 'Join code');
  String get join => t('انضمام', 'Join');
  String joinedTo(String name) => t('تعمل مع: $name', 'Driving with: $name');

  // Details
  String get fullName => t('الاسم الكامل كما في الهوية', 'Full name as on your ID');
  String get nationalId => t('رقم الهوية الوطنية', 'National ID number');
  String get nationalIdInvalid => t('رقم الهوية غير صحيح', 'Invalid national ID');
  String get dateOfBirth => t('تاريخ الميلاد', 'Date of birth');
  String get pickDate => t('اختر التاريخ', 'Choose a date');
  String get saudiConfirm =>
      t('أقر بأنني مواطن سعودي وأن البيانات صحيحة', 'I confirm I am a Saudi citizen and these details are correct');
  String get saudiNote => t(
      'تشترط الهيئة العامة للنقل أن يكون سائق السيارة الخاصة سعوديا.',
      'The Transport General Authority requires private-car drivers to be Saudi.');
  String get save => t('حفظ', 'Save');

  // Vehicle
  String get plateLetters => t('حروف اللوحة', 'Plate letters');
  String get plateLettersHint => t('مثال: ا ب ح', 'e.g. ABJ');
  String get plateNumbers => t('أرقام اللوحة', 'Plate numbers');
  String get make => t('الشركة المصنعة', 'Make');
  String get model => t('الطراز', 'Model');
  String get year => t('سنة الصنع', 'Model year');
  String get color => t('اللون', 'Colour');
  String get seats => t('عدد مقاعد الركاب', 'Passenger seats');
  String ageRule(int maxYears) => t(
      'يشترط ألا يتجاوز عمر المركبة $maxYears سنوات من سنة الصنع.',
      'The vehicle must be at most $maxYears years old from its model year.');
  String get required => t('مطلوب', 'Required');

  // Documents
  String docName(String type) => switch (type) {
        'driver_photo' => t('صورتك الشخصية', 'Your photo'),
        'national_id' => t('الهوية الوطنية', 'National ID'),
        'driving_license' => t('رخصة القيادة', 'Driving licence'),
        'vehicle_registration' => t('استمارة المركبة', 'Vehicle registration'),
        'vehicle_insurance' => t('تأمين المركبة', 'Vehicle insurance'),
        'periodic_inspection' => t('الفحص الدوري', 'Periodic inspection'),
        _ => type,
      };
  String docStatus(String status) => switch (status) {
        'pending' => t('بانتظار المراجعة', 'Waiting for review'),
        'accepted' => t('مقبولة', 'Accepted'),
        'rejected' => t('مرفوضة، أعد الرفع', 'Rejected, upload again'),
        _ => status,
      };
  String get upload => t('رفع', 'Upload');
  String get replace => t('تحديث', 'Replace');
  String get camera => t('التقاط صورة', 'Take a photo');
  String get gallery => t('اختيار من الصور', 'Choose a photo');
  String get pdf => t('اختيار ملف PDF', 'Choose a PDF');
  String get expiresAt => t('تاريخ انتهاء الوثيقة', 'Expiry date');
  String get expiresNeeded => t('اختر تاريخ الانتهاء أولا', 'Choose the expiry date first');
  String expires(String date) => t('تنتهي: $date', 'Expires: $date');
  String get uploading => t('جار الرفع…', 'Uploading…');
  String get uploaded => t('تم رفع الوثيقة', 'Document uploaded');
}
