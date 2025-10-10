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
    return (
      !result?.errors &&
      result?.data?.orderUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.orderUpdate?.order)
    );
  } catch {
    return false;
  }
}

export async function getCurrentPoints(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
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
    return parseInt(result.data.customer.metafield?.value || "0");
  } catch {
    return null;
  }
}

export function calculatePointsToDebit(order: OrderCreatedPayload): number {
  const pointsDiscount = order.discount_applications?.find(
    (discount) =>
      (discount.description || "") === "Pontos de vantagem" ||
      (discount.description || "").toLowerCase().includes("pontos") ||
      (discount.description || "").toLowerCase().includes("points"),
  );

  if (pointsDiscount) {
    const discountValue = parseFloat(pointsDiscount.value);
    return Math.round(discountValue / POINTS_TO_REAL_RATIO);
  }

  const pointsUsedAttribute = order.note_attributes?.find(
    (attr) => attr.name === "pointsToUse" || attr.name === "points_used",
  );
  if (pointsUsedAttribute) {
    return parseInt(pointsUsedAttribute.value) || 0;
  }
  return 0;
}

export function calculatePointsToAdd(
  totalPrice: string,
  currentLevel: number,
): number {
  const totalValue = parseFloat(totalPrice);
  const multiplier = POINTS_LEVEL[currentLevel]?.multiplier ?? 1;
  return Math.floor(totalValue) * multiplier;
}

export async function updateCustomerPoints(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
  newPoints: number,
): Promise<boolean> {
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
    return (
      !result?.errors &&
      result?.data?.customerUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.customerUpdate?.customer)
    );
  } catch {
    return false;
  }
}

export async function getCurrentClubLevel(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
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
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return null;
  }
}

export async function getCustomerTotalSpent(
  adminGraphQL: string,
  adminToken: string,
  customerId: string,
): Promise<number | null> {
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
    return Number.isNaN(amount) ? 0 : amount;
  } catch {
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
    return (
      !result?.errors &&
      result?.data?.customerUpdate?.userErrors?.length === 0 &&
      Boolean(result?.data?.customerUpdate?.customer)
    );
  } catch {
    return false;
  }
}


export const config = { runtime: "edge" } as const;

export default async function handler(req: Request): Promise<Response> {
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
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Read raw body for HMAC validation
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    return new Response(JSON.stringify({ error: "Missing HMAC header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
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
    if (calculatedHmac !== hmacHeader) {
      return new Response(JSON.stringify({ error: "Invalid HMAC" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "HMAC validation failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse order
  let order: OrderCreatedPayload;
  try {
    order = JSON.parse(rawBody) as OrderCreatedPayload;
  } catch {
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

  const success = await updateCustomerPoints(
    adminGraphQL,
    adminToken,
    customerId,
    finalPoints,
  );
  if (!success) {
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
