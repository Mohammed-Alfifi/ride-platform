'use client';

import { useEffect, useState } from 'react';

/** Points iPhone visitors at the web version and Android visitors at the APK. */
export function DeviceHint() {
  const [device, setDevice] = useState<'ios' | 'android' | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) setDevice('ios');
    else if (/Android/i.test(ua)) setDevice('android');
  }, []);
  if (!device) return null;
  return (
    <p className="device-hint" role="note">
      {device === 'ios'
        ? 'جهازك آيفون: استخدم «فتح نسخة الآيفون والمتصفح» في تطبيق الراكب.'
        : 'جهازك أندرويد: اضغط «تحميل لأندرويد» للتطبيق الذي تحتاجه.'}
    </p>
  );
}
