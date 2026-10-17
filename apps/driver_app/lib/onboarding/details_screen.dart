import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'models.dart';
import 'onboarding_controller.dart';
import 'strings.dart';

class DetailsScreen extends ConsumerStatefulWidget {
  const DetailsScreen({super.key});

  @override
  ConsumerState<DetailsScreen> createState() => _DetailsScreenState();
}

class _DetailsScreenState extends ConsumerState<DetailsScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: ref.read(onboardingProvider).valueOrNull?.details?.fullName ?? '');
  final _id = TextEditingController();
  DateTime? _dob;
  bool _confirmed = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final dob = ref.read(onboardingProvider).valueOrNull?.details?.dateOfBirth;
    if (dob != null) _dob = DateTime.tryParse(dob);
  }

  @override
  void dispose() {
    _name.dispose();
    _id.dispose();
    super.dispose();
  }

  String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(now.year - 30),
      firstDate: DateTime(now.year - 80),
      lastDate: DateTime(now.year - 18, now.month, now.day),
    );
    if (picked != null) setState(() => _dob = picked);
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false) || _dob == null || !_confirmed) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(onboardingProvider.notifier).saveDetails(
            fullName: _name.text,
            nationalId: _id.text.trim(),
            dateOfBirth: _iso(_dob!),
          );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = describeError(context, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = OnboardingStrings.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.stepDetails)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            TextFormField(
              controller: _name,
              decoration: InputDecoration(labelText: t.fullName),
              validator: (v) => (v ?? '').trim().length < 5 ? t.required : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _id,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
              decoration: InputDecoration(labelText: t.nationalId, hintText: '1XXXXXXXXX'),
              validator: (v) => isValidSaudiNationalId((v ?? '').trim()) ? null : t.nationalIdInvalid,
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _pickDob,
              icon: const Icon(Icons.calendar_today_outlined, size: 18),
              label: Text(_dob == null ? '${t.dateOfBirth}: ${t.pickDate}' : '${t.dateOfBirth}: ${_iso(_dob!)}'),
            ),
            const SizedBox(height: 16),
            CheckboxListTile(
              value: _confirmed,
              onChanged: (v) => setState(() => _confirmed = v ?? false),
              title: Text(t.saudiConfirm),
              subtitle: Text(t.saudiNote),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Brand.red)),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy || _dob == null || !_confirmed ? null : _save,
              child: _busy ? const ButtonSpinner() : Text(t.save),
            ),
          ],
        ),
      ),
    );
  }
}
