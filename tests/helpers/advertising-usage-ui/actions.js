export async function listAdvertisingUsageAction(input) {
 window.calls.push(input);
 const next = window.responses.shift();
 if (next?.hold) return new Promise(resolve => {window.release = resolve;});
 if(next) return next;
 return {...window.usage,month:input.month};
}

export async function getPlatformAdvertisingUsageAction(input) { return listAdvertisingUsageAction(input); }
