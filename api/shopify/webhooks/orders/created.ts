// Shared helpers for Shopify webhooks running on Vercel Edge
// Ported from app/routes/webhooks.orders.created.tsx in the Hydrogen app

// Constants for loyalty program
export const POINTS_TO_REAL_RATIO = 0.08; // 1 ponto = R$0.08

export const POINTS_LEVEL = [
  { id: 0, name: "Fora do clube", spent: 0, multiplier: 1 },
  { id: 1, name: "Bronze", spent: 0, multiplier: 1 },
  { id: 2, name: "Prata", spent: 180, multiplier: 1.2 },
  { id: 3, name: "Ouro", spent: 600, multiplier: 1.4 },
  { id: 4, name: "Diamante", spent: 1600, multiplier: 1.6 },
] as const;

// Types
export interface OrderCreatedPayload {
  id: number;
  name: string;
  email: string;
  total_price: string;
  financial_status?: string;
  note?: string;
  customer: { id: number; email: string } | null;
  note_attributes: Array<{ name: string; value: string }>;
  discount_applications: Array<{
    type: string;
    description: string;
    value: string;
    value_type: string;
    allocation_method: string;
  }>;
  total_discounts: string;
  line_items: Array<{
    id: number;
    variant_id: number;
    title: string;
    quantity: number;
    price: string;
  }>;
}

// GraphQL helpers
export async function updateOrderNote(
  adminGraphQL: string,
  adminToken: string,
  orderId: string,
  note: string,
): Promise<boolean> {
  console.log("[updateOrderNote] start", { orderId, noteLength: note?.length ?? 0 });
  const mutation = `
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `;

  const input = { id: orderId, note } as const;

  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query: mutation, variables: { input } }),
    });

    const result = (await response.json()) as any;
    console.log("[updateOrderNote] result", {
      hasErrors: Boolean(result?.errors),
      userErrorsCount: result?.data?.orderUpdate?.userErrors?.length ?? 0,
      hasOrder: Boolean(result?.data?.orderUpdate?.order),
    });
    return (
      !result?.errors &&
      result?.data?.orderUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.orderUpdate?.order)
    );
  } catch {
    console.log("[updateOrderNote] exception");
    return false;
  }
}

export async function getCurrentPoints(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
  console.log("[getCurrentPoints] start", { customerId });
  const query = `
    query getCustomer($id: ID!) {
      customer(id: $id) {
        metafield(namespace: "loyalty", key: "points") {
          value
        }
      }
    }
  `;

  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query, variables: { id: customerId } }),
    });
    const result = (await response.json()) as any;
    if (result?.errors || !result?.data?.customer) return null;
    const points = parseInt(result.data.customer.metafield?.value || "0");
    console.log("[getCurrentPoints] value", { points });
    return points;
  } catch {
    console.log("[getCurrentPoints] exception");
    return null;
  }
}

export function calculatePointsToDebit(order: OrderCreatedPayload): number {
  console.log("[calculatePointsToDebit] start", {
    orderId: order?.id,
    discountApplicationsCount: order?.discount_applications?.length ?? 0,
    noteAttributesCount: order?.note_attributes?.length ?? 0,
    totalDiscounts: order?.total_discounts,
  });
  const pointsDiscount = order.discount_applications?.find(
    (discount) =>
      (discount.description || "") === "Pontos de vantagem" ||
      (discount.description || "").toLowerCase().includes("pontos") ||
      (discount.description || "").toLowerCase().includes("points"),
  );

  if (pointsDiscount) {
    const discountValue = parseFloat(pointsDiscount.value);
    const debit = Math.round(discountValue / POINTS_TO_REAL_RATIO);
    console.log("[calculatePointsToDebit] from discount", { discountValue, debit });
    return debit;
  }

  const pointsUsedAttribute = order.note_attributes?.find(
    (attr) => attr.name === "pointsToUse" || attr.name === "points_used",
  );
  if (pointsUsedAttribute) {
    const debit = parseInt(pointsUsedAttribute.value) || 0;
    console.log("[calculatePointsToDebit] from note attribute", { debit });
    return debit;
  }
  return 0;
}

export function calculatePointsToAdd(
  totalPrice: string,
  currentLevel: number,
): number {
  const totalValue = parseFloat(totalPrice);
  const multiplier = POINTS_LEVEL[currentLevel]?.multiplier ?? 1;
  const toAdd = Math.floor(totalValue) * multiplier;
  console.log("[calculatePointsToAdd]", { totalValue, currentLevel, multiplier, toAdd });
  return toAdd;
}

export async function updateCustomerPoints(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
  newPoints: number,
): Promise<boolean> {
  console.log("[updateCustomerPoints] start", { customerId, newPoints });
  const mutation = `
    mutation customerUpdate($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;

  const input = {
    id: customerId,
    metafields: [
      {
        namespace: "loyalty",
        key: "points",
        value: newPoints.toString(),
        type: "number_decimal",
      },
    ],
  } as const;

  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query: mutation, variables: { input } }),
    });
    const result = (await response.json()) as any;
    console.log("[updateCustomerPoints] result", {
      hasErrors: Boolean(result?.errors),
      userErrorsCount: result?.data?.customerUpdate?.userErrors?.length ?? 0,
      hasCustomer: Boolean(result?.data?.customerUpdate?.customer),
    });
    return (
      !result?.errors &&
      result?.data?.customerUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.customerUpdate?.customer)
    );
  } catch {
    console.log("[updateCustomerPoints] exception");
    return false;
  }
}

export async function getCurrentClubLevel(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
  console.log("[getCurrentClubLevel] start", { customerId });
  const query = `
    query getCustomerClubLevel($id: ID!) {
      customer(id: $id) {
        metafield(namespace: "custom", key: "club_level") { value }
      }
    }
  `;
  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query, variables: { id: customerId } }),
    });
    const result = (await response.json()) as any;
    if (result?.errors || !result?.data?.customer) return null;
    const raw = result.data.customer.metafield?.value;
    if (raw === null || raw === undefined) return 0;
    const parsed = parseInt(raw);
    console.log("[getCurrentClubLevel] value", { value: Number.isNaN(parsed) ? 0 : parsed });
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    console.log("[getCurrentClubLevel] exception");
    return null;
  }
}

export async function getCustomerTotalSpent(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
  console.log("[getCustomerTotalSpent] start", { customerId });
  const query = `
    query getCustomerTotalSpent($id: ID!) {
      customer(id: $id) { amountSpent { amount currencyCode } }
    }
  `;
  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query, variables: { id: customerId } }),
    });
    const result = (await response.json()) as any;
    if (result?.errors || !result?.data?.customer) return null;
    const amount = parseFloat(result.data.customer.amountSpent?.amount || "0");
    console.log("[getCustomerTotalSpent] value", { amount: Number.isNaN(amount) ? 0 : amount });
    return Number.isNaN(amount) ? 0 : amount;
  } catch {
    console.log("[getCustomerTotalSpent] exception");
    return null;
  }
}

export function determineClubLevel(
  totalSpentInBRL: number,
  currentLevel: number,
): number {
  if (currentLevel === 0) return 0;
  const sortedLevels = [...POINTS_LEVEL].sort((a, b) => b.spent - a.spent);
  for (const level of sortedLevels) {
    if (totalSpentInBRL >= level.spent) return level.id;
  }
  return currentLevel;
}

export async function updateCustomerClubLevel(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
  newLevel: number,
): Promise<boolean> {
  console.log("[updateCustomerClubLevel] start", { customerId, newLevel });
  const mutation = `
    mutation customerUpdate($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;

  const input = {
    id: customerId,
    metafields: [
      {
        namespace: "custom",
        key: "club_level",
        value: newLevel.toString(),
        type: "number_integer",
      },
    ],
  } as const;

  try {
    const response = await fetchWithTimeout(adminGraphQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({ query: mutation, variables: { input } }),
    });
    const result = (await response.json()) as any;
    console.log("[updateCustomerClubLevel] result", {
      hasErrors: Boolean(result?.errors),
      userErrorsCount: result?.data?.customerUpdate?.userErrors?.length ?? 0,
      hasCustomer: Boolean(result?.data?.customerUpdate?.customer),
    });
    return (
      !result?.errors &&
      result?.data?.customerUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.customerUpdate?.customer)
    );
  } catch {
    console.log("[updateCustomerClubLevel] exception");
    return false;
  }
}

// Small helper to bound external calls so we don't exceed webhook time limits
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Read raw request body in both Edge (Request) and Node bridges
async function readRawBody(req: any): Promise<string> {
  console.log("[readRawBody] start");
  // Edge/Fetch Request provides .text() with the exact raw payload
  if (req && typeof req.text === "function") {
    console.log("[readRawBody] using req.text()");
    return await req.text();
  }

  // If a raw ArrayBuffer reader is available, prefer it to avoid any re-stringify differences
  if (typeof req?.arrayBuffer === "function") {
    console.log("[readRawBody] using req.arrayBuffer() fallback");
    const ab = await req.arrayBuffer();
    return new TextDecoder().decode(ab);
  }

  // Node.js IncomingMessage: read stream bytes directly
  if (req && typeof req.on === "function") {
    console.log("[readRawBody] using Node stream fallback");
    return await new Promise<string>((resolve, reject) => {
      const chunks: any[] = [];
      req.on("data", (chunk: any) => {
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          // Prefer Buffer if available (Node). Otherwise, concatenate strings.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const globalAny: any = globalThis as any;
          if (globalAny.Buffer) {
            const buf = globalAny.Buffer.concat(
              chunks.map((c: any) => (globalAny.Buffer.isBuffer(c) ? c : globalAny.Buffer.from(c))),
            );
            resolve(buf.toString("utf8"));
          } else {
            resolve(chunks.join(""));
          }
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", (err: unknown) => reject(err));
    });
  }

  // Some bridges expose req.body/req.rawBody. Use rawBody if present.
  // Already parsed or string
  if (req && (req as any).rawBody) {
    console.log("[readRawBody] using req.rawBody");
    const raw = (req as any).rawBody as unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    if (g.Buffer && g.Buffer.isBuffer(raw)) return (raw as any).toString("utf8");
    if (typeof raw === "string") return raw as string;
  }

  if (req && req.body) {
    // Web ReadableStream
    if (typeof ReadableStream !== "undefined" && req.body instanceof ReadableStream) {
      console.log("[readRawBody] using ReadableStream -> Response().text()");
      return await new Response(req.body).text();
    }
    if (typeof req.body === "string") {
      console.log("[readRawBody] using string body");
      return req.body;
    }
    if (typeof req.body === "object") {
      // Avoid re-stringifying parsed objects for HMAC when possible; only as a last resort
      console.log("[readRawBody] using JSON.stringify(object) body (last resort)");
      return JSON.stringify(req.body);
    }
  }

  console.log("[readRawBody] unsupported request body");
  throw new Error("Unsupported request body");
}

// Read raw request bytes (preferred for HMAC), with a matching string for JSON parsing
async function readRawBodyBytes(req: any): Promise<Uint8Array> {
  console.log("[readRawBodyBytes] start");
  // Prefer direct ArrayBuffer from the request (Edge/Fetch)
  if (typeof req?.arrayBuffer === "function") {
    console.log("[readRawBodyBytes] using req.arrayBuffer()");
    const ab = await req.arrayBuffer();
    return new Uint8Array(ab);
  }

  // Web ReadableStream available
  if (req && req.body && typeof ReadableStream !== "undefined" && req.body instanceof ReadableStream) {
    console.log("[readRawBodyBytes] using ReadableStream -> Response().arrayBuffer()");
    const ab = await new Response(req.body).arrayBuffer();
    return new Uint8Array(ab);
  }

  // If only text() is available, read it and encode to bytes
  if (req && typeof req.text === "function") {
    console.log("[readRawBodyBytes] using req.text() -> TextEncoder");
    const s = await req.text();
    return new TextEncoder().encode(s);
  }

  // Node IncomingMessage stream
  if (req && typeof req.on === "function") {
    console.log("[readRawBodyBytes] using Node stream");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    return await new Promise<Uint8Array>((resolve, reject) => {
      const chunks: any[] = [];
      req.on("data", (chunk: any) => chunks.push(chunk));
      req.on("end", () => {
        try {
          if (g.Buffer) {
            const buf = g.Buffer.concat(
              chunks.map((c: any) => (g.Buffer.isBuffer(c) ? c : g.Buffer.from(c))),
            );
            resolve(new Uint8Array(buf));
          } else {
            resolve(new TextEncoder().encode(chunks.join("")));
          }
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", (err: unknown) => reject(err));
    });
  }

  // rawBody provided by some adapters
  if (req && (req as any).rawBody) {
    console.log("[readRawBodyBytes] using req.rawBody");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = globalThis as any;
    const raw = (req as any).rawBody as unknown;
    if (g.Buffer && g.Buffer.isBuffer(raw)) return new Uint8Array(raw as any);
    if (typeof raw === "string") return new TextEncoder().encode(raw as string);
  }

  console.log("[readRawBodyBytes] unsupported request body");
  throw new Error("Unsupported request body");
}

function toBase64(ab: ArrayBuffer): string {
  try {
    // Browser/Edge
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any).btoa === "function") {
      const binary = String.fromCharCode(...new Uint8Array(ab));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).btoa(binary);
    }
  } catch {
    // no-op, fallback to Buffer
  }
  // Node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (g.Buffer) {
    return g.Buffer.from(new Uint8Array(ab)).toString("base64");
  }
  // Last resort (should not happen in our runtimes)
  let result = "";
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
  // Simple polyfill for btoa
  // eslint-disable-next-line no-undef
  // @ts-ignore
  return btoa(result);
}

// api/shopify/webhooks/orders/created.ts
export const runtime = 'edge';

// ====== suas constantes, tipos e helpers de GraphQL (inalterados) ======
// ... POINTS_TO_REAL_RATIO, POINTS_LEVEL, tipos, calculatePointsToDebit/ToAdd,
// getCurrentPoints, getCurrentClubLevel, getCustomerTotalSpent,
// determineClubLevel, updateOrderNote, updateCustomerPoints, updateCustomerClubLevel,
// fetchWithTimeout (mantenha igual)

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers.get(name) || req.headers.get(name.toLowerCase());
  return v ?? undefined;
}

export default async function handler(req: Request): Promise<Response> {
  // Timeout defensivo para a função como um todo
  const ac = new AbortController();
  const kill = setTimeout(() => ac.abort(), 4500);

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const adminGraphQL = process.env.PRIVATE_ADMIN_GRAPHQL_API_ENDPOINT;
    const adminToken   = process.env.PRIVATE_ADMIN_GRAPHQL_API_TOKEN;
    const webhookSecret= process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!adminGraphQL || !adminToken || !webhookSecret) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1) Body bruto e HMAC
    const rawBytes = await req.arrayBuffer();
    const hmacHeader = getHeader(req, 'x-shopify-hmac-sha256');
    if (!hmacHeader) {
      return new Response(JSON.stringify({ error: 'Missing HMAC header' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, rawBytes);
    const calculatedHmac = btoa(String.fromCharCode(...new Uint8Array(signature)));
    if (calculatedHmac !== hmacHeader) {
      return new Response(JSON.stringify({ error: 'Invalid HMAC' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2) Parse do pedido
    let order: OrderCreatedPayload;
    try {
      order = JSON.parse(new TextDecoder().decode(rawBytes));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!order.customer) {
      return new Response(JSON.stringify({ message: 'No customer associated with order' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const customerGid = `gid://shopify/Customer/${order.customer.id}`;
    const orderGid    = `gid://shopify/Order/${order.id}`;

    // Atualização de nota (não crítico) — pode aguardar rápido ou tornar fire-and-forget
    const noteText = 'pagamento avaliado pelo sistema de pontos';
    const existingNote = (order.note || '').trim();
    const newNote = existingNote ? `${existingNote} | ${noteText}` : noteText;
    await updateOrderNote(adminGraphQL!, adminToken!, orderGid, newNote);

    // 3) Pipeline de pontos
    const currentPoints = (await getCurrentPoints(adminGraphQL!, adminToken!, customerGid)) ?? 0;
    const pointsToDebit = calculatePointsToDebit(order);
    const currentLevel  = (await getCurrentClubLevel(adminGraphQL!, adminToken!, customerGid)) ?? 0;
    const pointsToAdd   = calculatePointsToAdd(order.total_price, currentLevel);

    let finalPoints = currentPoints - Math.min(pointsToDebit, currentPoints) + pointsToAdd;

    const okUpdate = await updateCustomerPoints(adminGraphQL!, adminToken!, customerGid, finalPoints);
    if (!okUpdate) {
      return new Response(JSON.stringify({ error: 'Failed to update customer points' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4) Manutenção do nível — best-effort (não precisa travar a resposta)
    getCustomerTotalSpent(adminGraphQL!, adminToken!, customerGid)
      .then(total => {
        if (total !== null) {
          const newLevel = determineClubLevel(total, currentLevel);
          if (newLevel !== currentLevel) {
            return updateCustomerClubLevel(adminGraphQL!, adminToken!, customerGid, newLevel);
          }
        }
      })
      .catch(() => { /* no-op best effort */ });

    // 5) Resposta imediata e enxuta
    const body = JSON.stringify({
      success: true,
      order: order.name,
      customer: order.customer.id,
      pointsDebited: Math.min(pointsToDebit, currentPoints),
      pointsAdded: pointsToAdd,
      previousBalance: currentPoints,
      newBalance: finalPoints,
    });

    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Internal server error', details: err?.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(kill);
  }
}
