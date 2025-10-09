import {
  OrderCreatedPayload,
  updateOrderNote,
  getCurrentPoints,
  calculatePointsToDebit,
  getCurrentClubLevel,
  calculatePointsToAdd,
  updateCustomerPoints,
  getCustomerTotalSpent,
  determineClubLevel,
  updateCustomerClubLevel,
} from "../../_lib";

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
