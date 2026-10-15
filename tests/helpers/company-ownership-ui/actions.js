async function run(kind, input) {
 const f = window.fixture; f[`${kind}Calls`].push(input);
 const response = f[`${kind}Responses`]?.shift();
 if (response?.throw) throw Error('Unknown');
 if (response?.defer) return new Promise(resolve => { f.resolve = resolve; });
 if (response) return structuredClone(response);
 if (kind === 'get') return { ok: true, ...structuredClone(f.page) };
 return { ok: true, receipt: { companyId: input.companyId, actorUserId: f.page.actorUserId, requestId: input.requestId, teamVersion: f.page.teamVersion, transfer: structuredClone(f.page.transfer) } };
}
export const getCompanyOwnershipTransferAction = input => run('get', input);
export const requestCompanyOwnershipTransferAction = input => run('request', input);
export const acceptCompanyOwnershipTransferAction = input => run('accept', input);
export const cancelCompanyOwnershipTransferAction = input => run('cancel', input);
