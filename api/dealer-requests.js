// Node request/response entry point for the Vercel API route.
export default async function handler(req, res) {
  const { handleRequests } = await import('../lib/dealer/handlers.mjs');
  return handleRequests(req, res);
}
