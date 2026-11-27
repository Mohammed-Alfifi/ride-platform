import type { Partner, PartnerLicense, Plan } from '../database/schema';

export interface ContractView {
  version: string;
  planId: string;
  titleAr: string;
  titleEn: string;
  clausesAr: string[];
  clausesEn: string[];
}

const sar = (halalas: number) => (halalas / 100).toFixed(2);

/**
 * The transport contract between the guardian and the licensed carrier for an education plan.
 * The regulation requires a formal contract that sets out each side's rights and duties; this is
 * its standard form. The guardian accepts the version shown, and the subscription records it.
 * Have the carrier's lawyer review the wording before the first sale.
 */
export function guardianContract(version: string, plan: Plan, partner: Partner, licence: PartnerLicense | undefined): ContractView {
  const carrierAr = partner.legalName ?? partner.nameAr;
  const carrierEn = partner.legalName ?? partner.nameEn;
  const licenceNo = licence?.unifiedCode ?? licence?.licenseNumber ?? '-';
  return {
    version,
    planId: plan.id,
    titleAr: 'عقد نقل طالب',
    titleEn: 'Student transport contract',
    clausesAr: [
      `الناقل: ${carrierAr}${partner.crNumber ? `، سجل تجاري ${partner.crNumber}` : ''}، ترخيص الهيئة العامة للنقل لنشاط النقل التعليمي رقم ${licenceNo}. منصة مشوار وسيط تقني ولا تنفذ النقل.`,
      `الخدمة: ${plan.nameAr}، ${plan.daysPerWeek} أيام في الأسبوع، ${plan.tripType === 'round_trip' ? 'ذهاب وعودة' : 'اتجاه واحد'}، بأجرة شهرية ${sar(plan.priceHalalas)} ريال شاملة الضريبة.`,
      'يلتزم الناقل بمركبة مرخصة للنقل التعليمي، وسائق يحمل بطاقة سائق مهني سارية، وبالتأمين والفحص الفني طوال مدة العقد.',
      plan.requiresEscort
        ? 'يرافق الطلاب في المركبة مرافق بالغ، ويتأكد السائق بعد كل رحلة من خلو المركبة من الطلاب.'
        : 'يتأكد السائق بعد كل رحلة من خلو المركبة من الطلاب.',
      'يلتزم ولي الأمر بتجهيز الطالب في موعد الركوب، وإبلاغ الناقل بالغياب من التطبيق قبل موعد الرحلة.',
      'يتجدد العقد شهريا مع الاشتراك، ويحق لولي الأمر إيقافه أو إلغاؤه من التطبيق وفق الشروط المعلنة فيه.',
      'تُرفع الشكاوى من التطبيق، ويحق لولي الأمر التقدم بها إلى الهيئة العامة للنقل.',
    ],
    clausesEn: [
      `Carrier: ${carrierEn}${partner.crNumber ? `, CR ${partner.crNumber}` : ''}, Transport General Authority education transport licence ${licenceNo}. Mishwar is a technology intermediary and does not carry passengers.`,
      `Service: ${plan.nameEn}, ${plan.daysPerWeek} days a week, ${plan.tripType === 'round_trip' ? 'round trip' : 'one way'}, monthly fare SAR ${sar(plan.priceHalalas)} including VAT.`,
      'The carrier provides a vehicle licensed for education transport and a driver with a valid professional driver card, insured and inspected throughout the contract.',
      plan.requiresEscort
        ? 'An adult escort rides with the students, and the driver checks after every trip that no student is left in the vehicle.'
        : 'The driver checks after every trip that no student is left in the vehicle.',
      'The guardian has the student ready at pick-up time and reports absences in the app before the trip.',
      'The contract renews monthly with the subscription; the guardian may pause or cancel it in the app under its published terms.',
      'Complaints are raised in the app; the guardian may also take them to the Transport General Authority.',
    ],
  };
}
