import { ErrorCode } from './errors';

export type Locale = 'ar' | 'en';

const messages: Record<Locale, Record<ErrorCode, string>> = {
  ar: {
    VALIDATION_FAILED: 'البيانات المرسلة غير صحيحة.',
    AUTH_PHONE_INVALID: 'رقم الجوال غير صحيح. أدخل رقم جوال سعودي صحيح.',
    AUTH_OTP_INVALID: 'رمز التحقق غير صحيح.',
    AUTH_OTP_EXPIRED: 'انتهت صلاحية رمز التحقق. اطلب رمزا جديدا.',
    AUTH_OTP_TOO_MANY_ATTEMPTS: 'تجاوزت عدد المحاولات المسموح. اطلب رمزا جديدا.',
    AUTH_OTP_RATE_LIMITED: 'طلبت رموزا كثيرة. حاول مرة أخرى بعد {retryAfter} ثانية.',
    AUTH_ACCOUNT_SUSPENDED: 'هذا الحساب موقوف. تواصل مع الدعم.',
    AUTH_TOKEN_INVALID: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
    AUTH_REFRESH_INVALID: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
    AUTH_REFRESH_REUSED: 'تم إنهاء الجلسة لأسباب أمنية. سجّل الدخول مرة أخرى.',
    FORBIDDEN: 'لا تملك صلاحية لهذا الإجراء.',
    NOT_FOUND: 'العنصر المطلوب غير موجود.',
    PARTNER_NOT_FOUND: 'الشريك غير موجود.',
    PARTNER_SUSPENDED: 'حساب الشريك موقوف.',
    PARTNER_CR_EXISTS: 'يوجد شريك مسجل بنفس رقم السجل التجاري.',
    USER_NOT_FOUND: 'المستخدم غير موجود.',
    USER_ALREADY_EXISTS: 'يوجد مستخدم بهذا الرقم مسبقا.',
    USER_CANNOT_MODIFY_SELF: 'لا يمكنك تعديل صلاحيات أو حالة حسابك بنفسك.',
    RATE_LIMITED: 'طلبات كثيرة. حاول بعد قليل.',
    DRIVER_JOIN_CODE_INVALID: 'رمز الشريك غير صحيح. تأكد منه مع شركة النقل.',
    DRIVER_NOT_JOINED: 'انضم إلى شريك نقل أولا برمز الانضمام.',
    DRIVER_ALREADY_JOINED: 'لا يمكن تغيير الشريك بعد إرسال طلبك.',
    DRIVER_LOCKED: 'لا يمكن تعديل البيانات أثناء المراجعة أو بعد الاعتماد.',
    DRIVER_NATIONAL_ID_INVALID: 'رقم الهوية الوطنية غير صحيح.',
    DRIVER_NATIONAL_ID_TAKEN: 'رقم الهوية مسجل لسائق آخر.',
    DRIVER_NOT_SAUDI: 'العمل بالسيارة الخاصة في تطبيقات النقل مقصور على السعوديين.',
    DRIVER_INCOMPLETE: 'أكمل البيانات والوثائق المطلوبة قبل الإرسال.',
    DRIVER_NOT_REVIEWABLE: 'هذا الطلب ليس بانتظار المراجعة.',
    DRIVER_DOCUMENTS_REJECTED: 'توجد وثائق مرفوضة. يجب أن يعيد السائق رفعها أولا.',
    VEHICLE_TOO_OLD: 'عمر المركبة يتجاوز المسموح ({maxYears} سنوات من سنة الصنع).',
    VEHICLE_PLATE_INVALID: 'رقم اللوحة غير صحيح.',
    VEHICLE_PLATE_TAKEN: 'هذه اللوحة مسجلة لمركبة أخرى.',
    DOCUMENT_FILE_UNSUPPORTED: 'نوع الملف غير مدعوم. ارفع صورة JPG أو PNG أو ملف PDF.',
    DOCUMENT_TOO_LARGE: 'حجم الملف أكبر من {maxMb} ميجابايت.',
    DOCUMENT_EXPIRY_REQUIRED: 'أدخل تاريخ انتهاء الوثيقة.',
    DOCUMENT_EXPIRED: 'الوثيقة منتهية. ارفع وثيقة سارية.',
    DOCUMENT_NOT_FOUND: 'الوثيقة غير موجودة.',
    ZONE_INVALID: 'حدود النطاق غير صالحة. ارسم مضلعا مغلقا لا تتقاطع أضلاعه.',
    ZONE_NOT_FOUND: 'النطاق غير موجود.',
    PLAN_NOT_FOUND: 'الباقة غير موجودة.',
    INTERNAL: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
  },
  en: {
    VALIDATION_FAILED: 'The submitted data is invalid.',
    AUTH_PHONE_INVALID: 'Invalid phone number. Enter a valid Saudi mobile number.',
    AUTH_OTP_INVALID: 'The verification code is incorrect.',
    AUTH_OTP_EXPIRED: 'The verification code has expired. Request a new one.',
    AUTH_OTP_TOO_MANY_ATTEMPTS: 'Too many attempts. Request a new code.',
    AUTH_OTP_RATE_LIMITED: 'Too many codes requested. Try again in {retryAfter} seconds.',
    AUTH_ACCOUNT_SUSPENDED: 'This account is suspended. Contact support.',
    AUTH_TOKEN_INVALID: 'Your session has ended. Please sign in again.',
    AUTH_REFRESH_INVALID: 'Your session has ended. Please sign in again.',
    AUTH_REFRESH_REUSED: 'Your session was ended for security reasons. Please sign in again.',
    FORBIDDEN: 'You do not have permission to do this.',
    NOT_FOUND: 'The requested item was not found.',
    PARTNER_NOT_FOUND: 'Partner not found.',
    PARTNER_SUSPENDED: 'The partner account is suspended.',
    PARTNER_CR_EXISTS: 'A partner with this commercial registration number already exists.',
    USER_NOT_FOUND: 'User not found.',
    USER_ALREADY_EXISTS: 'A user with this phone number already exists.',
    USER_CANNOT_MODIFY_SELF: 'You cannot change your own role or status.',
    RATE_LIMITED: 'Too many requests. Please slow down.',
    DRIVER_JOIN_CODE_INVALID: 'That partner code is not valid. Check it with the transport company.',
    DRIVER_NOT_JOINED: 'Join a transport partner first using its join code.',
    DRIVER_ALREADY_JOINED: 'You cannot change partner after submitting your application.',
    DRIVER_LOCKED: 'Your details cannot change while under review or after approval.',
    DRIVER_NATIONAL_ID_INVALID: 'The national ID number is not valid.',
    DRIVER_NATIONAL_ID_TAKEN: 'This national ID is registered to another driver.',
    DRIVER_NOT_SAUDI: 'Driving a private car on ride apps is limited to Saudi citizens.',
    DRIVER_INCOMPLETE: 'Complete the required details and documents before submitting.',
    DRIVER_NOT_REVIEWABLE: 'This application is not waiting for review.',
    DRIVER_DOCUMENTS_REJECTED: 'Some documents are rejected. The driver must upload them again first.',
    VEHICLE_TOO_OLD: 'The vehicle is older than allowed ({maxYears} years from its model year).',
    VEHICLE_PLATE_INVALID: 'The plate number is not valid.',
    VEHICLE_PLATE_TAKEN: 'This plate is registered to another vehicle.',
    DOCUMENT_FILE_UNSUPPORTED: 'Unsupported file. Upload a JPG or PNG photo or a PDF.',
    DOCUMENT_TOO_LARGE: 'The file is larger than {maxMb} MB.',
    DOCUMENT_EXPIRY_REQUIRED: 'Enter the document expiry date.',
    DOCUMENT_EXPIRED: 'This document has expired. Upload a valid one.',
    DOCUMENT_NOT_FOUND: 'Document not found.',
    ZONE_INVALID: 'The area is not valid. Draw a closed shape whose sides do not cross.',
    ZONE_NOT_FOUND: 'Area not found.',
    PLAN_NOT_FOUND: 'Plan not found.',
    INTERNAL: 'Something went wrong. Please try again.',
  },
};

/** Picks ar or en from an Accept-Language header. Arabic is the default. */
export function resolveLocale(acceptLanguage?: string | string[]): Locale {
  const header = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  if (!header) return 'ar';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'ar';
}

export function translate(
  code: ErrorCode,
  locale: Locale,
  params: Record<string, string | number> = {},
): string {
  const template = messages[locale][code] ?? messages.ar[code];
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}
