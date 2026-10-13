import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceLoader } from './helpers/source-loader.mjs';
const loader = await createSourceLoader();
const { calculateVehicle, roundRatioHalfUp, parseOre, MAX_AMOUNT_ORE, formatOre, kronorToOre } = loader.load('./src/lib/calculations/vehicle-calculation.ts');
const base = { companyId: 'company', stockItemId: 'stock', version: '1', purchaseGrossOre: '10000000', saleGrossOre: '12500000', purchaseVatOre: '2000000', vatScheme: 'standard', vatBasisConfirmed: false,
  costs: [{ id: 'repair', description: 'Reparation', grossOre: '1250000', deductibleVatOre: '250000' }] };
test('normal 25% uses exact explicit deductions; gross comparison remains a different result', () => {
  const result = calculateVehicle(base);
  assert.equal(result.grossDifferenceOre, '1250000'); assert.equal(result.outputVatOre, '2500000');
  assert.equal(result.netResultOre, '1000000'); assert.deepEqual(result.missing, []);
});
test('individual VMB never subtracts repair costs from the taxable sale-minus-purchase margin', () => {
  const result = calculateVehicle({ ...base, vatScheme: 'vmb', purchaseVatOre: null, vatBasisConfirmed: true });
  assert.equal(result.grossDifferenceOre, '1250000'); assert.equal(result.outputVatOre, '500000'); assert.equal(result.netResultOre, '1000000');
  const unknownRepair = calculateVehicle({ ...base, vatScheme: 'vmb', purchaseVatOre: null, vatBasisConfirmed: true, costs: [{ ...base.costs[0], deductibleVatOre: null }] });
  assert.equal(unknownRepair.outputVatOre, '500000'); assert.equal(unknownRepair.netResultOre, null);
});
test('Skatteverket individual VMB example 900kr ->1000kr produces20kr output VAT', () => {
  const result = calculateVehicle({ ...base, vatScheme: 'vmb', purchaseVatOre: null, vatBasisConfirmed: true, purchaseGrossOre: '90000', saleGrossOre: '100000', costs: [] });
  assert.equal(result.outputVatOre, '2000'); assert.equal(result.netResultOre, '8000');
});
test('losses and zero VMB margins never create negative VAT or erase the loss', () => {
  const result = calculateVehicle({ ...base, vatScheme: 'vmb', purchaseVatOre: null, vatBasisConfirmed: true, saleGrossOre: '9000000' });
  assert.equal(result.outputVatOre, '0'); assert.equal(result.netResultOre, '-2000000');
  const zero = calculateVehicle({ ...base, vatScheme: 'vmb', purchaseVatOre: null, vatBasisConfirmed: true, saleGrossOre: base.purchaseGrossOre, costs: [] });
  assert.equal(zero.netResultOre, '0'); assert.equal(zero.outputVatOre, '0');
});
test('unknown VAT and unconfirmed VMB only show gross comparison; missing deductions are never zero', () => {
  for (const patch of [{ vatScheme: 'unknown' }, { vatScheme: 'vmb', purchaseVatOre: null }, { purchaseVatOre: null }, { costs: [{ ...base.costs[0], deductibleVatOre: null }] }]) {
    const result = calculateVehicle({ ...base, ...patch });
    assert.equal(result.netResultOre, null); assert.equal(result.grossDifferenceOre, '1250000'); assert.ok(result.missing.length);
  }
  assert.equal(calculateVehicle({ ...base, purchaseVatOre: '0', costs: [{ ...base.costs[0], deductibleVatOre: '0' }] }).netResultOre, '-1250000');
});
test('half-up rounding is symmetric and cents around 25/125 are exact', () => {
  assert.equal(roundRatioHalfUp(1n, 2n), 1n); assert.equal(roundRatioHalfUp(-1n, 2n), -1n);
  assert.throws(() => roundRatioHalfUp(1n, 0n));
  for (const [gross, vat] of [['0', '0'], ['1', '0'], ['2', '0'], ['3', '1'], ['4', '1'], ['5', '1'], ['8', '2']]) {
    assert.equal(calculateVehicle({ ...base, purchaseGrossOre: '0', saleGrossOre: gross, purchaseVatOre: '0', costs: [] }).outputVatOre, vat);
  }
});
test('large PGbigint values stay exact, invalid/negative/floating/unsafe/overflow sources fail closed', () => {
  const value = MAX_AMOUNT_ORE.toString();
  assert.equal(parseOre(value), MAX_AMOUNT_ORE);
  assert.equal(calculateVehicle({ ...base, purchaseGrossOre: value, saleGrossOre: value, purchaseVatOre: '0', costs: [] }).grossDifferenceOre, '0');
  for (const invalid of [null, undefined, -1, 1, Number.MAX_SAFE_INTEGER + 1, '1.01', '-1', '01', '1e3', '', ' 1', (MAX_AMOUNT_ORE + 1n).toString()]) {
    assert.throws(() => calculateVehicle({ ...base, saleGrossOre: invalid }));
  }
  assert.throws(() => calculateVehicle({ ...base, purchaseVatOre: '10000001' }));
  assert.throws(() => calculateVehicle({ ...base, purchaseVatOre: '2000001' }));
  assert.throws(() => calculateVehicle({ ...base, vatScheme: 'vmb', vatBasisConfirmed: true }));
  assert.throws(() => calculateVehicle({ ...base, costs: [{ ...base.costs[0], deductibleVatOre: '1250001' }] }));
  assert.throws(() => calculateVehicle({ ...base, costs: [{ ...base.costs[0], deductibleVatOre: '250001' }] }));
});
test('exact formatting and decimal input never round a money value through Number', () => {
  assert.equal(formatOre('9007199254740993'), '90 071 992 547 409,93 kr');
  assert.equal(formatOre('-1'), '−0,01 kr'); assert.equal(kronorToOre('12,50'), '1250');
  assert.equal(kronorToOre('0'), '0'); assert.equal(kronorToOre(''), null);
  for (const input of ['-1', '01', '12.345', '1e3', '1 000', '999999999999999999999999']) assert.throws(() => kronorToOre(input));
});
