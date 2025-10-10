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
    const response = await fetch(adminGraphQL, {
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
    const response = await fetch(adminGraphQL, {
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
    const response = await fetch(adminGraphQL, {
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
    const response = await fetch(adminGraphQL, {
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
    const response = await fetch(adminGraphQL, {
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
    const response = await fetch(adminGraphQL, {
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


export const config = { runtime: "edge" } as const;

// Read raw request body in both Edge (Request) and Node bridges
async function readRawBody(req: any): Promise<string> {
  console.log("[readRawBody] start");
  if (req && typeof req.text === "function") {
    console.log("[readRawBody] using req.text()");
    return await req.text();
  }
  if (req && req.body) {
    // Web ReadableStream
    if (typeof ReadableStream !== "undefined" && req.body instanceof ReadableStream) {
      console.log("[readRawBody] using ReadableStream -> Response().text()");
      return await new Response(req.body).text();
    }
    // Already parsed or string
    if (typeof req.body === "string") {
      console.log("[readRawBody] using string body");
      return req.body;
    }
    if (typeof req.body === "object") {
      console.log("[readRawBody] using JSON.stringify(object) body");
      return JSON.stringify(req.body);
    }
  }
  if (typeof req.arrayBuffer === "function") {
    console.log("[readRawBody] using req.arrayBuffer() fallback");
    const ab = await req.arrayBuffer();
    return new TextDecoder().decode(ab);
  }
  console.log("[readRawBody] unsupported request body");
  throw new Error("Unsupported request body");
}

export default async function handler(req: Request): Promise<Response> {
  console.log("request", req);
  console.log("[handler] start", {
    method: req?.method,
    url: (req as any)?.url,
    contentType: req.headers.get("content-type"),
    topic: req.headers.get("x-shopify-topic"),
    shop: req.headers.get("x-shopify-shop-domain"),
  });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const adminGraphQL = process.env.PRIVATE_ADMIN_GRAPHQL_API_ENDPOINT as
    | string
    | undefined;
  const adminToken = process.env.PRIVATE_ADMIN_GRAPHQL_API_TOKEN as
    | string
    | undefined;
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET as
    | string
    | undefined;

  if (!adminGraphQL || !adminToken || !webhookSecret) {
    console.log("[handler] missing env", {
      hasAdminGraphQL: Boolean(adminGraphQL),
      hasAdminToken: Boolean(adminToken),
      hasWebhookSecret: Boolean(webhookSecret),
    });
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Read raw body for HMAC validation
  const rawBody = await readRawBody(req as any);
  console.log("[handler] body read", { length: rawBody?.length ?? 0, preview: (rawBody || "").slice(0, 256) });
  const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    console.log("[handler] missing HMAC header");
    return new Response(JSON.stringify({ error: "Missing HMAC header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[handler] HMAC validation start");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody),
    );
    const calculatedHmac = btoa(
      String.fromCharCode(...new Uint8Array(signature)),
    );
    console.log("[handler] HMAC compared", {
      headerLength: hmacHeader.length,
      calculatedLength: calculatedHmac.length,
      match: calculatedHmac === hmacHeader,
      header: hmacHeader,
      calculated: calculatedHmac,
    });
    if (calculatedHmac !== hmacHeader) {
      return new Response(JSON.stringify({ error: "Invalid HMAC" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    console.log("[handler] HMAC validation failed (exception)");
    return new Response(JSON.stringify({ error: "HMAC validation failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse order
  let order: OrderCreatedPayload;
  try {
    order = JSON.parse(rawBody) as OrderCreatedPayload;
    console.log("[handler] order parsed", {
      id: order?.id,
      name: order?.name,
      email: order?.email,
      total_price: order?.total_price,
      hasCustomer: Boolean(order?.customer),
    });
  } catch {
    console.log("[handler] invalid JSON body");
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!order.customer) {
    return new Response(
      JSON.stringify({ message: "No customer associated with order" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Early note update (non-fatal if fails)
  try {
    const orderGid = `gid://shopify/Order/${order.id}`;
    const noteText = "pagamento avaliado pelo sistema de pontos";
    const existingNote = (order.note || "").trim();
    const newNote = existingNote ? `${existingNote} | ${noteText}` : noteText;
    console.log("[handler] updating order note", { orderGid, noteLength: newNote.length });
    await updateOrderNote(adminGraphQL, adminToken, orderGid, newNote);
  } catch (e) {
    console.warn("[webhook] note update skipped:", (e as any)?.message || e);
  }

  const customerId = `gid://shopify/Customer/${order.customer.id}`;

  // Points pipeline
  const currentPoints =
    (await getCurrentPoints(adminGraphQL, adminToken, customerId)) ?? 0;
  const pointsToDebit = calculatePointsToDebit(order);
  const currentClubLevel =
    (await getCurrentClubLevel(adminGraphQL, adminToken, customerId)) ?? 0;
  const pointsToAdd = calculatePointsToAdd(order.total_price, currentClubLevel);

  let finalPoints = currentPoints;
  if (pointsToDebit > 0) finalPoints -= Math.min(pointsToDebit, currentPoints);
  finalPoints += pointsToAdd;
  console.log("[handler] points summary", {
    currentPoints,
    pointsToDebit,
    currentClubLevel,
    pointsToAdd,
    finalPoints,
  });

  const success = await updateCustomerPoints(
    adminGraphQL,
    adminToken,
    customerId,
    finalPoints,
  );
  if (!success) {
    console.log("[handler] failed to update customer points");
    return new Response(
      JSON.stringify({ error: "Failed to update customer points" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Club level maintenance (best-effort)
  try {
    const totalSpent = await getCustomerTotalSpent(
      adminGraphQL,
      adminToken,
      customerId,
    );
    if (totalSpent !== null) {
      const newClubLevel = determineClubLevel(totalSpent, currentClubLevel);
      console.log("[handler] club level check", { totalSpent, currentClubLevel, newClubLevel });
      if (newClubLevel !== currentClubLevel) {
        await updateCustomerClubLevel(
          adminGraphQL,
          adminToken,
          customerId,
          newClubLevel,
        );
      }
    }
  } catch (e) {
    console.warn(
      "[webhook] club level update skipped:",
      (e as any)?.message || e,
    );
  }

  console.log("[handler] success", {
    order: order.name,
    customer: order.customer.id,
    pointsDebited: Math.min(pointsToDebit, currentPoints),
    pointsAdded: pointsToAdd,
    previousBalance: currentPoints,
    newBalance: finalPoints,
  });
  return new Response(
    JSON.stringify({
      success: true,
      order: order.name,
      customer: order.customer.id,
      pointsDebited: Math.min(pointsToDebit, currentPoints),
      pointsAdded: pointsToAdd,
      previousBalance: currentPoints,
      newBalance: finalPoints,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
