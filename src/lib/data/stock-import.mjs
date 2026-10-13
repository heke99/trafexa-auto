import Papa from 'papaparse';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const STOCK_FIELDS = [
  { key: 'registration_number', label: 'Registreringsnummer', aliases: ['regnr', 'registreringsnummer', 'registration', 'registrationnumber'] },
  { key: 'make', label: 'Märke', aliases: ['marke', 'brand'] },
  { key: 'model', label: 'Modell', aliases: ['modell'] },
  { key: 'model_year', label: 'Årsmodell', aliases: ['arsmodell', 'year'] },
  { key: 'mileage_km', label: 'Mätarställning, km', aliases: ['matarstallningkm', 'miltalkm', 'kilometer', 'mileage'] },
  { key: 'fuel', label: 'Drivmedel', aliases: ['drivmedel', 'fueltype'] },
  { key: 'gearbox', label: 'Växellåda', aliases: ['vaxellada', 'transmission'] },
  { key: 'purchase_price', label: 'Inköpspris inklusive eventuell moms, kr', aliases: ['inkopspris', 'inkopspriskr', 'inkopsprisinklusiveeventuellmomskr', 'purchaseprice'] },
  { key: 'asking_price', label: 'Försäljningspris, kr', aliases: ['forsaljningspris', 'forsaljningspriskr', 'askingprice', 'pris'] },
  { key: 'vat_scheme', label: 'Momsmodell', aliases: ['momsmodell', 'moms', 'vat'] },
];

/** @typedef {{row: number|null, field: string, message: string}} ImportIssue */
/** @typedef {{headers: string[], rows: {rowNumber:number,cells:string[]}[], errors:ImportIssue[], delimiter:string}} ParsedStockCsv */
/** @typedef {Record<string,number>} StockMapping */
/** @typedef {{registration_number:string,make:string,model:string,model_year:number,mileage_km:number,fuel:string,gearbox:string,purchase_price_ore:number,asking_price_ore:number,vat_scheme:string}} NormalizedStockRow */

const normalizeHeader = (value) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
/** @param {string} value */
export function normalizeRegistration(value) { return value.trim().toUpperCase().replace(/\s/g, ''); }

/** @param {string} text @returns {ParsedStockCsv} */
export function parseStockCsv(text) {
  /** @type {ImportIssue[]} */
  const errors = [];
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    return { headers: [], rows: [], delimiter: '', errors: [{ row: null, field: 'file', message: 'CSV-filen får vara högst 1 MB.' }] };
  }
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { header: false, skipEmptyLines: 'greedy', delimitersToGuess: [',', ';'], dynamicTyping: false });
  for (const error of parsed.errors) errors.push({ row: typeof error.row === 'number' ? error.row + 1 : null, field: 'file', message: 'CSV-formatet är ogiltigt. Kontrollera avgränsare och citattecken.' });
  const data = /** @type {string[][]} */ (parsed.data);
  const headers = (data[0] ?? []).map((value) => value.trim());
  if (!headers.length || headers.every((value) => !value)) errors.push({ row: 1, field: 'file', message: 'Filen behöver en rubrikrad.' });
  if (headers.length > 50) errors.push({ row: 1, field: 'file', message: 'CSV-filen får ha högst 50 kolumner.' });
  if (headers.some((value) => !value || value.length > 160)) errors.push({ row: 1, field: 'file', message: 'Varje kolumn behöver en rubrik med högst 160 tecken.' });
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) errors.push({ row: 1, field: 'file', message: 'Kolumnrubrikerna måste vara unika.' });
  const rows = data.slice(1).map((cells, index) => ({ rowNumber: index + 2, cells }));
  if (!rows.length) errors.push({ row: null, field: 'file', message: 'Filen innehåller inga bilar.' });
  if (rows.length > MAX_IMPORT_ROWS) errors.push({ row: null, field: 'file', message: 'Importera högst 500 bilar åt gången.' });
  for (const row of rows) if (row.cells.length !== headers.length) errors.push({ row: row.rowNumber, field: 'file', message: 'Raden har ett annat antal kolumner än rubrikraden.' });
  return { headers, rows, errors, delimiter: parsed.meta.delimiter };
}

/** @param {string[]} headers @returns {StockMapping} */
export function suggestStockMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  return Object.fromEntries(STOCK_FIELDS.map((field) => [field.key, normalized.findIndex((header) => [normalizeHeader(field.key), ...field.aliases].includes(header))]));
}

/** @param {string} value @param {boolean} [allowZero] */
export function stockMoneyToOre(value, allowZero = true) {
  const trimmed = value.trim();
  // Space grouping is accepted only in groups of three. Dots are decimal separators.
  if (!/^(?:\d{1,10}|\d{1,3}(?:[ \u00A0\u202F]\d{3}){1,3})(?:[.,]\d{1,2})?$/.test(trimmed)) throw new Error('Ange kronor med högst två decimaler, utan valuta eller tusentalskomma.');
  const normalized = trimmed.replace(/[ \u00A0\u202F]/g, '').replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  if (whole.length > 10) throw new Error('Beloppet får vara högst 9 999 999 999,99 kr.');
  const ore = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(ore) || (!allowZero && ore === 0)) throw new Error('Försäljningspriset måste vara större än noll.');
  return ore;
}

const fuelValues = { petrol: 'petrol', bensin: 'petrol', diesel: 'diesel', electric: 'electric', el: 'electric', hybrid: 'hybrid', laddhybrid: 'hybrid', other: 'other', annat: 'other' };
const gearboxValues = { automatic: 'automatic', automat: 'automatic', manual: 'manual', manuell: 'manual' };
const vatValues = { standard: 'standard', vanligmoms: 'standard', vmb: 'vmb', unknown: 'unknown', okand: 'unknown', ejklassificerad: 'unknown' };

/** @param {string} raw @param {number} min @param {number} max */
function integer(raw, min, max) {
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new Error(`Ange ett heltal mellan ${min} och ${max}.`);
  return Number(raw);
}

/** @param {ParsedStockCsv} parsed @param {StockMapping} mapping @param {string[]} [existingRegistrations] @param {number} [currentYear] */
export function validateStockRows(parsed, mapping, existingRegistrations = [], currentYear = new Date().getUTCFullYear()) {
  /** @type {ImportIssue[]} */
  const issues = [...parsed.errors];
  const selected = [];
  for (const field of STOCK_FIELDS) {
    const column = mapping?.[field.key];
    if (!Number.isInteger(column) || column < 0 || column >= parsed.headers.length) issues.push({ row: null, field: field.key, message: `Välj kolumn för ${field.label.toLowerCase()}.` });
    else selected.push(column);
  }
  if (new Set(selected).size !== selected.length) issues.push({ row: null, field: 'mapping', message: 'Varje kolumn får användas till ett fält.' });
  /** @type {NormalizedStockRow[]} */
  const rows = [];
  /** @type {{rowNumber:number,registration:string,make:string,model:string,values:NormalizedStockRow|null,issues:ImportIssue[]}[]} */
  const preview = [];
  if (issues.some((issue) => issue.row === null || issue.field === 'file')) return { rows, issues, preview, canImport: false };
  const existing = new Set(existingRegistrations.map(normalizeRegistration));
  const seen = new Map();
  for (const record of parsed.rows) {
    const raw = Object.fromEntries(STOCK_FIELDS.map((field) => [field.key, (record.cells[mapping[field.key]] ?? '').trim()]));
    const registration = normalizeRegistration(raw.registration_number);
    /** @type {ImportIssue[]} */
    const rowIssues = [];
    /** @type {Record<string,string|number>} */
    const values = {};
    for (const field of STOCK_FIELDS) {
      try {
        const value = raw[field.key];
        if (!value) throw new Error(field.key === 'vat_scheme' ? 'Ange standard, vmb eller unknown uttryckligen.' : 'Uppgiften saknas.');
        switch (field.key) {
          case 'registration_number':
            if (!/^[A-Z0-9-]{2,15}$/.test(registration)) throw new Error('Ange 2–15 bokstäver eller siffror, med eventuellt bindestreck.');
            values.registration_number = registration; break;
          case 'make': case 'model':
            if (value.length > 160 || /[\u0000-\u001F\u007F]/.test(value)) throw new Error('Ange högst 160 tecken utan radbrytning eller kontrolltecken.');
            values[field.key] = value; break;
          case 'model_year': values.model_year = integer(value, 1900, Math.min(2100, currentYear + 2)); break;
          case 'mileage_km': values.mileage_km = integer(value, 0, 3000000); break;
          case 'purchase_price': values.purchase_price_ore = stockMoneyToOre(value); break;
          case 'asking_price': values.asking_price_ore = stockMoneyToOre(value, false); break;
          case 'fuel': case 'gearbox': case 'vat_scheme': {
            const choices = field.key === 'fuel' ? fuelValues : field.key === 'gearbox' ? gearboxValues : vatValues;
            const choice = choices[normalizeHeader(value)];
            if (!choice) throw new Error(field.key === 'vat_scheme' ? 'Ange standard, vmb eller unknown uttryckligen.' : 'Ange ett giltigt alternativ.');
            values[field.key] = choice; break;
          }
        }
      } catch (error) { rowIssues.push({ row: record.rowNumber, field: field.key, message: error instanceof Error ? error.message : 'Uppgiften är ogiltig.' }); }
    }
    if (existing.has(registration)) rowIssues.push({ row: record.rowNumber, field: 'registration_number', message: 'Registreringsnumret finns redan i företagets lager.' });
    if (seen.has(registration)) {
      rowIssues.push({ row: record.rowNumber, field: 'registration_number', message: `Dubblett i filen, samma registreringsnummer som rad ${seen.get(registration)}.` });
      const first = preview.find((item) => item.rowNumber === seen.get(registration));
      const firstIssue = { row: seen.get(registration), field: 'registration_number', message: `Dubblett i filen, samma registreringsnummer som rad ${record.rowNumber}.` };
      if (first) first.issues.push(firstIssue);
      issues.push(firstIssue);
    } else seen.set(registration, record.rowNumber);
    const normalized = rowIssues.length ? null : /** @type {NormalizedStockRow} */ (values);
    if (normalized) rows.push(normalized);
    issues.push(...rowIssues);
    preview.push({ rowNumber: record.rowNumber, registration, make: raw.make, model: raw.model, values: normalized, issues: rowIssues });
  }
  return { rows, issues, preview, canImport: issues.length === 0 && rows.length > 0 };
}
