import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enumField, integerField, moneyField, requiredField, textField, uuidField } from '../src/lib/data/validation.ts';

function form(value, key = 'value') {
  const data = new FormData();
  if (value !== undefined) data.set(key, value);
  return data;
}

test('text fields reject overflow without silently discarding a customer note', () => {
  const note = `${'a'.repeat(2000)} Do not release the vehicle before payment.`;
  assert.throws(() => textField(form(note), 'value', 2000), /högst 2000 tecken/);
  assert.equal(textField(form('a'.repeat(2000)), 'value', 2000).length, 2000);
  assert.equal(textField(form('  Volvo  '), 'value', 5), 'Volvo');
  assert.throws(() => requiredField(form('Business name exceeds the limit'), 'value', 2, 10), /högst 10 tecken/);
});

test('optional absence and blank text are supported, while file inputs are rejected', () => {
  assert.equal(textField(form(), 'value'), '');
  assert.equal(textField(form(' \t\n '), 'value'), '');
  assert.throws(() => requiredField(form(), 'value'), /obligatoriska/);
  assert.throws(() => requiredField(form(' \n '), 'value'), /obligatoriska/);
  assert.throws(() => textField(form(new File(['private data'], 'note.txt')), 'value'), /som text/);
  assert.throws(() => enumField(form(new File(['sales'], 'role.txt')), 'value', ['sales'], 'sales'), /som text/);
});

test('money is parsed exactly into öre without rounding or accepting alternate numeric formats', () => {
  for (const [value, expected] of [['0.29', 29], ['1,09', 109], ['12 500,50', 1250050], ['9999999999.99', 999999999999]]) {
    assert.equal(moneyField(form(value), 'value'), expected);
  }
  assert.equal(moneyField(form('0'), 'value', true), 0);
  for (const value of ['0', '-1', '1.001', '1e2', '0x10', 'NaN', 'Infinity', '10000000000', '1,234.56', '1.2.3']) {
    assert.throws(() => moneyField(form(value), 'value'), Error, value);
  }
});

test('integer fields reject exponent, hexadecimal, fractional and unsafe values', () => {
  assert.equal(integerField(form(' 2026 '), 'value', 1900, 2100), 2026);
  assert.equal(integerField(form('0'), 'value', 0, 3000000), 0);
  assert.equal(integerField(form(), 'value', 0, 3000000, 0), 0);
  assert.equal(integerField(form(''), 'value', 1, 120, 12), 12);
  for (const value of ['0x7ea', '2.026e3', '2026.0', '2026.5', 'Infinity', 'NaN', '1899', '2101', '9007199254740993']) {
    assert.throws(() => integerField(form(value), 'value', 1900, 2100), Error, value);
  }
  assert.throws(() => integerField(form('9007199254740993'), 'value', 0, Number.POSITIVE_INFINITY), /Kontrollera/);
  assert.throws(() => integerField(form(), 'value', 1, 120), /Kontrollera/);
  assert.throws(() => integerField(form(), 'value', 1, 120, 121), /Kontrollera/);
});

test('enum and UUID fields accept their defined choices and reject forged values', () => {
  assert.equal(enumField(form(), 'value', ['repair', 'other'], 'other'), 'other');
  assert.equal(enumField(form(' repair '), 'value', ['repair', 'other']), 'repair');
  assert.throws(() => enumField(form('admin'), 'value', ['repair', 'other'], 'other'), /giltigt alternativ/);
  const id = 'BB759A30-281A-4FF0-983C-6BB23442DB58';
  assert.equal(uuidField(form(` ${id} `), 'value'), id);
  for (const value of ['not-a-uuid', `${id}/foreign-company`, 'bb759a30-281a-4ff0-983c-6bb23442db5g', '']) {
    assert.throws(() => uuidField(form(value), 'value'), Error, value);
  }
});
