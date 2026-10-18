import { operator } from '@/lib/operator';

/** Support contact for the public pages, from the server settings. */
export function Contact() {
  const op = operator();
  if (!op.whatsapp && !op.email) return null;
  return (
    <>
      <h2>التواصل</h2>
      <p>
        {op.whatsapp && (
          <>
            واتساب:{' '}
            <a href={op.whatsappUrl} dir="ltr">
              {op.whatsapp}
            </a>
          </>
        )}
        {op.whatsapp && op.email && '، '}
        {op.email && (
          <>
            البريد: <a href={`mailto:${op.email}`}>{op.email}</a>
          </>
        )}
      </p>
    </>
  );
}
