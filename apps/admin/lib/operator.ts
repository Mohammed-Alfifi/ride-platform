import 'server-only';

/** Who runs the service, for the public legal pages. Set these on the server (server.env). */
export function operator() {
  const whatsapp = (process.env.SUPPORT_WHATSAPP ?? '').trim();
  return {
    name: (process.env.OPERATOR_NAME ?? '').trim() || 'مشوار',
    cr: (process.env.OPERATOR_CR ?? '').trim(),
    email: (process.env.SUPPORT_EMAIL ?? '').trim(),
    whatsapp,
    whatsappUrl: whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, '').replace(/^0/, '966')}` : '',
    city: (process.env.OPERATOR_CITY ?? '').trim() || 'الرياض',
  };
}
