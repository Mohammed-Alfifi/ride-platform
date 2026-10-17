# تطبيق السائق

## أول تشغيل

```bash
flutter create --platforms=android,ios --org sa.yourcompany --project-name driver_app .
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

## صلاحيات المنصات (مطلوبة لرفع الوثائق)

**iOS** — أضف إلى `ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>لتصوير وثائقك ورخصتك عند التسجيل كسائق</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>لاختيار صور وثائقك من ألبوم الصور</string>
```

**Android** — لا يحتاج `image_picker` و `file_picker` صلاحيات إضافية على Android 13+.
للأجهزة الأقدم أضف إلى `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
```

## ما يحتويه حتى المرحلة 2

- الدخول برمز التحقق.
- الانضمام لشريك برمز الانضمام، البيانات الشخصية، المركبة، رفع الوثائق الست بالكاميرا أو الصور أو PDF.
- إرسال الطلب، ومتابعة حالته (قيد المراجعة، أعيد للتعديل مع الأسباب، معتمد).
- تنبيه الإيقاف عند انتهاء وثيقة، وتجديد الوثائق بعد الاعتماد.
