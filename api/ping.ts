
export const config = { runtime: 'edge' }; // (ou export const runtime = 'edge' no App Router)

export default async function handler(req: Request): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, message: 'pong' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}