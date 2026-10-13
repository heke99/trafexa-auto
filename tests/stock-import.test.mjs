import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseStockCsv, suggestStockMapping, stockMoneyToOre, validateStockRows } from '../src/lib/data/stock-import.mjs';

const header = 'registration_number;make;model;model_year;mileage_km;fuel;gearbox;purchase_price;asking_price;vat_scheme';
const valid = ['ABC123', 'Volvo', 'V60', '2022', '50123', 'hybrid', 'automatic', '125000,29', '159000,09', 'unknown'];
const csv = (rows = [valid]) => `${header}\n${rows.map((row) => row.join(';')).join('\n')}`;
function check(text, existing = [], mapping) { const parsed = parseStockCsv(text); return validateStockRows(parsed, mapping ?? suggestStockMapping(parsed.headers), existing, 2026); }

test('CSV BOM, semicolon, Swedish decimal money and explicit unknown VAT produce exact stock values', () => {
  const checked = check(`\uFEFF${csv()}`);
  assert.equal(checked.canImport, true);
  assert.equal(checked.rows[0].purchase_price_ore, 12500029);
  assert.equal(checked.rows[0].asking_price_ore, 15900009);
  assert.equal(checked.rows[0].vat_scheme, 'unknown');
  assert.equal(checked.rows[0].mileage_km, 50123);
});

test('comma CSV handles quoted comma fields and doubled quote characters', () => {
  const text = `${header.replaceAll(';', ',')}\r\nABC123,Volvo,"V60, \"\"Plus\"\"",2022,50123,hybrid,automatic,125000.29,159000.09,standard\r\n`;
  const checked = check(text);
  assert.equal(checked.canImport, true);
  assert.equal(checked.rows[0].model, 'V60, "Plus"');
  assert.equal(checked.rows[0].vat_scheme, 'standard');
});

test('quoted fields preserve semicolon and embedded newline while row validation reports unsupported model controls', () => {
  const text = `${header}\nABC123;Volvo;"V60; Plus\nLimited";2022;50123;hybrid;automatic;125000,29;159000,09;vmb`;
  const parsed = parseStockCsv(text);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].cells[2], 'V60; Plus\nLimited');
  assert.equal(parsed.errors.length, 0);
  assert.equal(check(text).canImport, false);
  assert.equal(check(text).issues[0].field, 'model');
});

test('CSV blank lines are ignored and normalized registration numbers use uppercase without spaces', () => {
  const row = [...valid]; row[0] = ' ab c123 ';
  const checked = check(`\n${csv([row])}\n\n  \n`);
  assert.equal(checked.canImport, true);
  assert.equal(checked.rows[0].registration_number, 'ABC123');
});

test('Swedish column names and value aliases map explicitly without defaulting VAT or fuel', () => {
  const text = 'Reg.nr;Märke;Modell;Årsmodell;Mätarställning km;Drivmedel;Växellåda;Inköpspris kr;Försäljningspris kr;Momsmodell\nABC123;Volvo;V60;2022;50123;El;Manuell;0;1,09;Ej klassificerad';
  const checked = check(text);
  assert.equal(checked.canImport, true);
  assert.equal(checked.rows[0].fuel, 'electric');
  assert.equal(checked.rows[0].gearbox, 'manual');
  assert.equal(checked.rows[0].vat_scheme, 'unknown');
  assert.equal(checked.rows[0].purchase_price_ore, 0);
});

test('money uses exact integer öre and validates grouping rather than silently rounding or truncating', () => {
  for (const [raw, expected] of [['0', 0], ['0.29', 29], ['1,09', 109], ['12 500,50', 1250050], ['12\u00a0500,50', 1250050], ['9 999 999 999,99', 999999999999]]) assert.equal(stockMoneyToOre(raw), expected);
  for (const raw of ['1.001', '1,234.56', '1e3', '0x10', '-1', 'NaN', 'Infinity', '12 50', '1 2', '10000000000', '9999999999.999', '100 kr']) assert.throws(() => stockMoneyToOre(raw), Error, raw);
  assert.throws(() => stockMoneyToOre('0', false), /större än noll/);
});

test('all required fields are mapped to separate columns and cannot be reused', () => {
  const parsed = parseStockCsv(csv());
  const missing = suggestStockMapping(parsed.headers); missing.vat_scheme = -1;
  assert.equal(validateStockRows(parsed, missing).canImport, false);
  assert.match(validateStockRows(parsed, missing).issues[0].message, /Välj kolumn/);
  const reused = suggestStockMapping(parsed.headers); reused.vat_scheme = reused.fuel;
  assert.match(validateStockRows(parsed, reused).issues[0].message, /Varje kolumn/);
  assert.equal(validateStockRows(parsed, { ...missing, vat_scheme: '9' }).canImport, false);
  assert.equal(validateStockRows(parsed, { ...missing, vat_scheme: 99 }).canImport, false);
});

test('VAT is always explicit and invalid numeric precision is attached to its CSV record', () => {
  const row = [...valid]; row[7] = '125000,299'; row[9] = '';
  const checked = check(csv([valid, ['DEF456', ...row.slice(1)]]));
  assert.equal(checked.canImport, false);
  assert.deepEqual(checked.issues.map((issue) => [issue.row, issue.field]), [[3, 'purchase_price'], [3, 'vat_scheme']]);
});

test('file duplicates report both records after registration normalization', () => {
  const duplicate = [...valid]; duplicate[0] = 'a b c123';
  const checked = check(csv([valid, duplicate]));
  assert.equal(checked.canImport, false);
  assert.equal(checked.issues.filter((issue) => issue.field === 'registration_number').length, 2);
  assert.deepEqual(checked.preview.map((row) => row.issues.length), [1, 1]);
});

test('own existing inventory is matched after normalization with no overwrite path', () => {
  const checked = check(csv(), [' ab c123 ']);
  assert.equal(checked.canImport, false);
  assert.match(checked.issues[0].message, /finns redan/);
});

test('bad CSV quote syntax, duplicate/empty headers and inconsistent columns block the entire import', () => {
  for (const text of [`${header}\n"ABC123;Volvo`, `${header};make\n${valid.join(';')};Volvo`, `${header};\n${valid.join(';')};unused`, `${header}\n${valid.slice(0, 9).join(';')}`, `${header}\n${valid.join(';')};unexpected`]) {
    assert.equal(check(text).canImport, false, text);
    assert.ok(parseStockCsv(text).errors.length > 0);
  }
});

test('empty/header-only CSV and oversized header arrays cannot be imported', () => {
  for (const text of ['', '\n \n', header, Array.from({ length: 51 }, (_, index) => `col${index}`).join(';') + '\n' + Array(51).fill('x').join(';')]) assert.equal(check(text).canImport, false);
});

test('UTF-8 bytes, including multibyte characters, determine the strict 1 MB limit', () => {
  assert.equal(parseStockCsv('x'.repeat(MAX_IMPORT_BYTES + 1)).rows.length, 0);
  assert.match(parseStockCsv('å'.repeat(MAX_IMPORT_BYTES / 2 + 1)).errors[0].message, /1 MB/);
  assert.notEqual(parseStockCsv('x'.repeat(MAX_IMPORT_BYTES)).errors[0].message, 'CSV-filen får vara högst 1 MB.');
});

test('500 CSV records are accepted and record 501 is never silently discarded', () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => [`T${String(index).padStart(5, '0')}`, ...valid.slice(1)]);
  assert.equal(check(csv(rows)).canImport, true);
  rows.push(['EXTRA1', ...valid.slice(1)]);
  const parsed = parseStockCsv(csv(rows));
  assert.equal(parsed.rows.length, 501);
  assert.equal(check(csv(rows)).canImport, false);
  assert.match(parsed.errors[0].message, /500/);
});

test('year/mileage are bounded integers and names are never truncated', () => {
  for (const [column, raw] of [[3, '2029'], [3, '1899'], [3, '2022.5'], [3, '2e3'], [4, '1.5'], [4, '-1'], [4, '3000001'], [4, '9007199254740993'], [1, 'x'.repeat(161)]]) {
    const row = [...valid]; row[column] = raw;
    const checked = check(csv([row]));
    assert.equal(checked.canImport, false, raw);
    assert.equal(checked.issues.length, 1, raw);
  }
});

test('forged fuel, gearbox and VAT choices are rejected instead of defaulted', () => {
  for (const column of [5, 6, 9]) { const row = [...valid]; row[column] = 'unrecognized'; assert.equal(check(csv([row])).canImport, false); }
});
