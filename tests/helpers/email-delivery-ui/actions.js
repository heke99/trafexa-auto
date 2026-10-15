export async function getTransactionalEmailStatusAction() {
  window.fixture.reads++;
  const result = window.fixture.statusResponses.shift() ?? window.fixture.status;
  if (result.throw) throw new Error('Fixture read failure');
  return result;
}
export async function dispatchTransactionalEmailAction(input) {
  window.fixture.sends.push(input);
  const result = window.fixture.sendResponses.shift();
  if (result.throw) throw new Error('Fixture unknown result');
  return result;
}
