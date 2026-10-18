// Export is outside these browser scenarios; never pull backend code into their bundle.
const unavailable = async () => ({ ok: false, code: 'unavailable', message: 'Export ingår inte i denna testvy.' });
export const getPlatformAdvertisingPaymentExportAction = unavailable;
export const getAdvertisingPaymentExportAction = unavailable;
