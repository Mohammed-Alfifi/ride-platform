import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_core/mobile_core.dart';

import 'onboarding_controller.dart';
import 'strings.dart';

/// Upload one document: choose its expiry date (when it has one), then a photo or PDF.
class DocumentScreen extends ConsumerStatefulWidget {
  const DocumentScreen({super.key, required this.type});
  final String type;

  @override
  ConsumerState<DocumentScreen> createState() => _DocumentScreenState();
}

class _DocumentScreenState extends ConsumerState<DocumentScreen> {
  DateTime? _expiry;
  double? _progress;
  String? _error;

  bool get _needsExpiry => widget.type != 'driver_photo';
  bool get _allowsPdf => widget.type != 'driver_photo';

  String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiry ?? now.add(const Duration(days: 365)),
      firstDate: now.add(const Duration(days: 1)),
      lastDate: DateTime(now.year + 15),
    );
    if (picked != null) setState(() => _expiry = picked);
  }

  Future<void> _fromCamera() => _fromImagePicker(ImageSource.camera);
  Future<void> _fromGallery() => _fromImagePicker(ImageSource.gallery);

  Future<void> _fromImagePicker(ImageSource source) async {
    // Photos are resized and compressed on the phone: sharper than needed costs data and time.
    final file = await ImagePicker().pickImage(
      source: source,
      maxWidth: 2000,
      maxHeight: 2000,
      imageQuality: 80,
      preferredCameraDevice: widget.type == 'driver_photo' ? CameraDevice.front : CameraDevice.rear,
    );
    if (file != null) await _upload(file.path, file.name);
  }

  Future<void> _fromFiles() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf']);
    final path = result?.files.single.path;
    if (path != null) await _upload(path, result!.files.single.name);
  }

  Future<void> _upload(String path, String name) async {
    final t = OnboardingStrings.of(context);
    if (_needsExpiry && _expiry == null) {
      setState(() => _error = t.expiresNeeded);
      return;
    }
    setState(() {
      _progress = 0;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      await ref.read(onboardingProvider.notifier).uploadDocument(
            type: widget.type,
            filePath: path,
            fileName: name,
            expiresAt: _needsExpiry ? _iso(_expiry!) : null,
            onProgress: (p) {
              if (mounted) setState(() => _progress = p);
            },
          );
      messenger.showSnackBar(SnackBar(content: Text(t.uploaded)));
      navigator.pop();
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    final busy = _progress != null;
    final ready = !_needsExpiry || _expiry != null;
    return Scaffold(
      appBar: AppBar(title: Text(t.docName(widget.type))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_needsExpiry) ...[
            OutlinedButton.icon(
              onPressed: busy ? null : _pickExpiry,
              icon: const Icon(Icons.event_outlined, size: 18),
              label: Text(_expiry == null ? '${t.expiresAt}: ${t.pickDate}' : '${t.expiresAt}: ${_iso(_expiry!)}'),
            ),
            const SizedBox(height: 24),
          ],
          FilledButton.icon(
            onPressed: busy || !ready ? null : _fromCamera,
            icon: const Icon(Icons.photo_camera_outlined),
            label: Text(t.camera),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: busy || !ready ? null : _fromGallery,
            icon: const Icon(Icons.photo_library_outlined),
            label: Text(t.gallery),
          ),
          if (_allowsPdf) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: busy || !ready ? null : _fromFiles,
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: Text(t.pdf),
            ),
          ],
          if (busy) ...[
            const SizedBox(height: 24),
            Text(t.uploading),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: _progress),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Brand.red)),
          ],
        ],
      ),
    );
  }
}
