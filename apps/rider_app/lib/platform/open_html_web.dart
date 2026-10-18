import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// Opens an HTML document (a printable invoice) in a new tab from memory, so the access token
/// never appears in a URL.
void openHtmlInNewTab(String html) {
  final blob = web.Blob([html.toJS].toJS, web.BlobPropertyBag(type: 'text/html;charset=utf-8'));
  final url = web.URL.createObjectURL(blob);
  web.window.open(url, '_blank');
}
