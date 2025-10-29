

export default async function handler(req: Request): Promise<Response> {

    return new Response("test succeeded", { status: 200, headers: { 'Content-Type': 'application/json' } });
    
}