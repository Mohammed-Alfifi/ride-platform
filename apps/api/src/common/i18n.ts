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
