import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_core/mobile_core.dart';

import 'onboarding_controller.dart';
import 'strings.dart';

/// Keep in step with VEHICLE_MAX_AGE_YEARS on the server; the server has the final word.
const _maxAgeYears = 5;

class VehicleScreen extends ConsumerStatefulWidget {
  const VehicleScreen({super.key});

  @override
  ConsumerState<VehicleScreen> createState() => _VehicleScreenState();
}

class _VehicleScreenState extends ConsumerState<VehicleScreen> {
  final _form = GlobalKey<FormState>();
  late final _existing = ref.read(onboardingProvider).valueOrNull?.vehicle;
  late final _letters = TextEditingController(text: _existing?.plateLetters ?? '');
  late final _numbers = TextEditingController(text: _existing?.plateNumbers ?? '');
  late final _make = TextEditingController(text: _existing?.make ?? '');
  late final _model = TextEditingController(text: _existing?.model ?? '');
  late final _color = TextEditingController(text: _existing?.color ?? '');
  late int _year = _existing?.year ?? DateTime.now().year;
  late int _seats = _existing?.seats ?? 4;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_letters, _numbers, _make, _model, _color]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(onboardingProvider.notifier).saveVehicle({
        'plateLetters': _letters.text.trim(),
        'plateNumbers': _numbers.text.trim(),
        'make': _make.text.trim(),
        'model': _model.text.trim(),
        'year': _year,
        'color': _color.text.trim(),
        'seats': _seats,
      });
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
    final thisYear = DateTime.now().year;
    final years = [for (var y = thisYear + 1; y >= thisYear - _maxAgeYears; y--) y];
    String? needed(String? v) => (v ?? '').trim().isEmpty ? t.required : null;

    return Scaffold(
      appBar: AppBar(title: Text(t.stepVehicle)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _letters,
                    decoration: InputDecoration(labelText: t.plateLetters, hintText: t.plateLettersHint),
                    validator: needed,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _numbers,
                    keyboardType: TextInputType.number,
                    textDirection: TextDirection.ltr,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                    decoration: InputDecoration(labelText: t.plateNumbers),
                    validator: needed,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(controller: _make, decoration: InputDecoration(labelText: t.make, hintText: 'Toyota'), validator: needed),
            const SizedBox(height: 16),
            TextFormField(controller: _model, decoration: InputDecoration(labelText: t.model, hintText: 'Camry'), validator: needed),
            const SizedBox(height: 16),
            DropdownButtonFormField<int>(
              value: years.contains(_year) ? _year : years.first,
              decoration: InputDecoration(labelText: t.year, helperText: t.ageRule(_maxAgeYears), helperMaxLines: 2),
              items: [for (final y in years) DropdownMenuItem(value: y, child: Text('$y'))],
              onChanged: (v) => setState(() => _year = v ?? _year),
            ),
            const SizedBox(height: 16),
            TextFormField(controller: _color, decoration: InputDecoration(labelText: t.color), validator: needed),
            const SizedBox(height: 16),
            DropdownButtonFormField<int>(
              value: _seats,
              decoration: InputDecoration(labelText: t.seats),
              items: [for (var s = 1; s <= 7; s++) DropdownMenuItem(value: s, child: Text('$s'))],
              onChanged: (v) => setState(() => _seats = v ?? _seats),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Brand.red)),
            ],
            const SizedBox(height: 24),
            FilledButton(onPressed: _busy ? null : _save, child: _busy ? const ButtonSpinner() : Text(t.save)),
          ],
        ),
      ),
    );
  }
}
