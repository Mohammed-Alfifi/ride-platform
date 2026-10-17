/// Light client-side check before calling the API (the server does the authoritative validation).
/// Returns the number as +9665XXXXXXXX, or null when it cannot be a Saudi mobile.
String? normalizeSaudiMobile(String input) {
  final ascii = input
      .split('')
      .map((c) {
        final code = c.codeUnitAt(0);
        if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(code - 0x0660 + 48);
        if (code >= 0x06F0 && code <= 0x06F9) return String.fromCharCode(code - 0x06F0 + 48);
        return c;
      })
      .join()
      .replaceAll(RegExp(r'[\s\-().]'), '');

  var digits = ascii;
  if (digits.startsWith('+')) digits = digits.substring(1);
  if (digits.startsWith('00')) digits = digits.substring(2);
  if (digits.startsWith('966')) digits = digits.substring(3);
  if (digits.startsWith('0')) digits = digits.substring(1);

  if (!RegExp(r'^5\d{8}$').hasMatch(digits)) return null;
  return '+966$digits';
}

/// +966501234567 -> 050 123 4567
String formatSaudiMobile(String e164) {
  final m = RegExp(r'^\+966(5\d)(\d{3})(\d{4})$').firstMatch(e164);
  if (m == null) return e164;
  return '0${m.group(1)} ${m.group(2)} ${m.group(3)}';
}
