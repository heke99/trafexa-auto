export default async function handler(req, res) {
  const { handleRequest } = await import('../lib/dealer/handlers.mjs');
  return handleRequest(req, res);
}
