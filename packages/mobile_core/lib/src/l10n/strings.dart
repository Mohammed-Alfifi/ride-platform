import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_error.dart';

/// The app language. Arabic by default; follows the user's saved preference after sign-in.
final languageProvider = StateProvider<Locale>((ref) => const Locale('ar'));

const supportedLocales = [Locale('ar'), Locale('en')];

/// UI strings shared by both apps. Server error messages arrive already localised.
class Strings {
  const Strings._(this._m);
  final Map<String, String> _m;

  static Strings of(BuildContext context) =>
      Localizations.localeOf(context).languageCode == 'en' ? _en : _ar;

  String get(String key, [Map<String, Object> args = const {}]) {
    var value = _m[key] ?? _ar._m[key] ?? key;
    args.forEach((k, v) => value = value.replaceAll('{$k}', '$v'));
    return value;
  }

  String get phoneTitle => get('phoneTitle');
  String get phoneIntroRider => get('phoneIntroRider');
  String get phoneIntroDriver => get('phoneIntroDriver');
  String get phoneLabel => get('phoneLabel');
  String get phoneInvalid => get('phoneInvalid');
  String get sendCode => get('sendCode');
  String get codeTitle => get('codeTitle');
  String codeSentTo(String phone) => get('codeSentTo', {'phone': phone});
  String get verify => get('verify');
  String get changeNumber => get('changeNumber');
  String resendIn(int s) => get('resendIn', {'s': s});
  String get resend => get('resend');
  String get networkError => get('networkError');
  String get genericError => get('genericError');
  String get profile => get('profile');
  String get name => get('name');
  String get nameHint => get('nameHint');
  String get save => get('save');
  String get saved => get('saved');
  String get language => get('language');
  String get otherLanguage => get('otherLanguage');
  String get signOut => get('signOut');
  String get signOutEverywhere => get('signOutEverywhere');
  String get signOutEverywhereConfirm => get('signOutEverywhereConfirm');
  String get cancel => get('cancel');
  String get phoneNumber => get('phoneNumber');
  String get retry => get('retry');
  String get accessCodeTitle => get('accessCodeTitle');
  String accessCodeIntro(String phone) => get('accessCodeIntro', {'phone': phone});
  String get accessCodeHelp => get('accessCodeHelp');
  String get notifications => get('notifications');
  String get noNotifications => get('noNotifications');
  String get termsTitle => get('termsTitle');
  String get termsIntro => get('termsIntro');
  List<String> get termsPoints => get('termsPoints').split('|');
  String get terms => get('terms');
  String get privacy => get('privacy');
  String get termsAgree => get('termsAgree');
  String get termsAccept => get('termsAccept');
  String get sos => get('sos');
  String get sosTitle => get('sosTitle');
  String get sosIntro => get('sosIntro');
  String sosCall(String n) => get('sosCall', {'n': n});
  String get sosReport => get('sosReport');
  String get sosSent => get('sosSent');
  String get whatsappSupport => get('whatsappSupport');
  String get deleteAccount => get('deleteAccount');
  String get deleteAccountConfirm => get('deleteAccountConfirm');
  String get deleteAccountDone => get('deleteAccountDone');
  String get delete => get('delete');
  String get legal => get('legal');

  static const _ar = Strings._({
    'phoneTitle': 'أدخل رقم جوالك',
    'phoneIntroRider': 'سنرسل لك رمز تحقق لتسجيل الدخول أو إنشاء حسابك.',
    'phoneIntroDriver': 'سجّل بجوالك للانضمام كسائق لدى شريك نقل مرخّص.',
    'phoneLabel': 'رقم الجوال',
    'phoneInvalid': 'أدخل رقم جوال سعودي يبدأ بـ 05',
    'sendCode': 'إرسال الرمز',
    'codeTitle': 'أدخل رمز التحقق',
    'codeSentTo': 'أرسلنا رمزا من 6 أرقام إلى {phone}',
    'verify': 'تأكيد',
    'changeNumber': 'تغيير الرقم',
    'resendIn': 'إعادة الإرسال بعد {s} ثانية',
    'resend': 'إعادة إرسال الرمز',
    'networkError': 'تعذر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.',
    'genericError': 'حدث خطأ غير متوقع. حاول مرة أخرى.',
    'profile': 'حسابي',
    'name': 'الاسم',
    'nameHint': 'كيف يناديك السائق أو الفريق؟',
    'save': 'حفظ',
    'saved': 'تم الحفظ',
    'language': 'اللغة',
    'otherLanguage': 'English',
    'signOut': 'تسجيل الخروج',
    'signOutEverywhere': 'تسجيل الخروج من كل الأجهزة',
    'signOutEverywhereConfirm': 'سيتم إنهاء جلساتك على كل الأجهزة. هل تريد المتابعة؟',
    'cancel': 'إلغاء',
    'phoneNumber': 'رقم الجوال',
    'retry': 'إعادة المحاولة',
    'accessCodeTitle': 'أدخل رمز الدخول',
    'accessCodeIntro': 'اكتب رمز الدخول المكون من 8 أرقام الذي وصلك على الواتساب من فريق مشوار للرقم {phone}.',
    'accessCodeHelp': 'لم يصلك رمز؟ اطلبه من فريق مشوار.',
    'notifications': 'الإشعارات',
    'noNotifications': 'لا توجد إشعارات بعد.',
    'termsTitle': 'قبل أن تبدأ',
    'termsIntro': 'مشوار في مرحلة تجربة محدودة. اقرأ الشروط وسياسة الخصوصية، وأهم ما فيهما:',
    'termsPoints': 'نستخدم بياناتك لتشغيل رحلاتك فقط، ولا نبيعها ولا نعلن بها.|موقع السائق يُسجل أثناء الرحلات فقط ويُحذف بعد 30 يوما.|كن جاهزا في الموعد؛ ينتظر السائق خمس دقائق.|في الطوارئ استخدم زر الطوارئ أو اتصل بـ 911.|يمكنك حذف حسابك في أي وقت من صفحة حسابي.',
    'terms': 'الشروط والأحكام',
    'privacy': 'سياسة الخصوصية',
    'termsAgree': 'قرأت الشروط وسياسة الخصوصية وأوافق عليهما',
    'termsAccept': 'موافقة ومتابعة',
    'sos': 'طوارئ',
    'sosTitle': 'طوارئ',
    'sosIntro': 'في الخطر المباشر اتصل بالطوارئ أولا. بلاغك لفريق مشوار يصلهم فورا مع موقعك.',
    'sosCall': 'اتصل بالطوارئ {n}',
    'sosReport': 'أبلغ فريق مشوار الآن',
    'sosSent': 'وصل بلاغك لفريق التشغيل وسيتصلون بك الآن.',
    'whatsappSupport': 'تواصل معنا على الواتساب',
    'deleteAccount': 'حذف الحساب',
    'deleteAccountConfirm': 'سيُحذف حسابك وتُسجَّل خارجا من كل الأجهزة. تبقى الفواتير محفوظة كما يوجب النظام. هل تريد الحذف؟',
    'deleteAccountDone': 'تم حذف حسابك.',
    'delete': 'حذف',
    'legal': 'الشروط والخصوصية',
  });

  static const _en = Strings._({
    'phoneTitle': 'Enter your mobile number',
    'phoneIntroRider': 'We will text you a code to sign in or create your account.',
    'phoneIntroDriver': 'Sign up with your mobile to drive with a licensed transport partner.',
    'phoneLabel': 'Mobile number',
    'phoneInvalid': 'Enter a Saudi mobile number starting with 05',
    'sendCode': 'Send code',
    'codeTitle': 'Enter the code',
    'codeSentTo': 'We sent a 6-digit code to {phone}',
    'verify': 'Confirm',
    'changeNumber': 'Change number',
    'resendIn': 'Resend in {s}s',
    'resend': 'Resend code',
    'networkError': 'No connection. Check your internet and try again.',
    'genericError': 'Something went wrong. Please try again.',
    'profile': 'My account',
    'name': 'Name',
    'nameHint': 'What should your driver or team call you?',
    'save': 'Save',
    'saved': 'Saved',
    'language': 'Language',
    'otherLanguage': 'العربية',
    'signOut': 'Sign out',
    'signOutEverywhere': 'Sign out on all devices',
    'signOutEverywhereConfirm': 'This ends your sessions on every device. Continue?',
    'cancel': 'Cancel',
    'phoneNumber': 'Mobile number',
    'retry': 'Try again',
    'accessCodeTitle': 'Enter your access code',
    'accessCodeIntro': 'Type the 8-digit access code the Mishwar team sent on WhatsApp for {phone}.',
    'accessCodeHelp': 'No code? Ask the Mishwar team.',
    'notifications': 'Notifications',
    'noNotifications': 'No notifications yet.',
    'termsTitle': 'Before you start',
    'termsIntro': 'Mishwar is in a limited pilot. Read the terms and the privacy policy; the key points:',
    'termsPoints': 'We use your data only to run your rides; we never sell it or use it for ads.|The driver\'s location is recorded during trips only and deleted after 30 days.|Be ready on time; the driver waits five minutes.|In an emergency use the emergency button or call 911.|You can delete your account any time from My account.',
    'terms': 'Terms',
    'privacy': 'Privacy policy',
    'termsAgree': 'I have read and accept the terms and the privacy policy',
    'termsAccept': 'Accept and continue',
    'sos': 'Emergency',
    'sosTitle': 'Emergency',
    'sosIntro': 'If anyone is in danger, call emergency services first. A report to the Mishwar team reaches them at once with your location.',
    'sosCall': 'Call emergency {n}',
    'sosReport': 'Alert the Mishwar team now',
    'sosSent': 'Your report reached the operations team; they will call you now.',
    'whatsappSupport': 'Chat with us on WhatsApp',
    'deleteAccount': 'Delete account',
    'deleteAccountConfirm': 'Your account is deleted and you are signed out everywhere. Invoices are kept as the law requires. Delete it?',
    'deleteAccountDone': 'Your account was deleted.',
    'delete': 'Delete',
    'legal': 'Terms and privacy',
  });
}

/// Message to show for an error: the server's localised text, or a local fallback.
String describeError(BuildContext context, Object error) {
  final s = Strings.of(context);
  if (error is ApiError) {
    if (error.isNetwork) return s.networkError;
    if (error.message.isNotEmpty) return error.message;
  }
  return s.genericError;
}
