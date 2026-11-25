import Stripe from "stripe";

let stripe;

const REQUIRED_ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    return new Response("Server misconfigured.", { status: 500 });
  }

  stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);

  // Signature verification needs the exact raw request body Stripe sent —
  // parsing it as JSON first (like the other functions do) and
  // re-serializing it would change the bytes and fail verification, so this
  // reads it as text instead.
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response("Invalid signature.", { status: 400 });
  }

  // Sponsorship and donation payments (create-sponsorship.mjs): report them to
  // the Summit Sponsors sheet. Card payments are paid at checkout.session.completed.
  // Bank transfers (ACH) complete the session first and only count as paid when
  // checkout.session.async_payment_succeeded arrives later.
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    try {
      await recordSponsorshipPayment(event.data.object, stripe);
    } catch (err) {
      console.error("Failed to record sponsorship payment:", err);
      // 500 makes Stripe retry; the sheet ignores a payment it already has.
      return new Response("Failed to record payment.", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
};

// Exported for testing. Returns what it did, so tests can check it.
export async function recordSponsorshipPayment(session, stripeClient, fetchFn = fetch) {
  const md = session.metadata ?? {};
  if (md.type !== "sponsorship" && md.type !== "donation") return "ignored";
  // The Voltage Baseball Club site records its own payments from the same Stripe account.
  if (md.org !== "summit") return "ignored";
  if (session.payment_status !== "paid") return "not paid yet";

  const url = process.env.SHEET_WEBHOOK_URL;
  const token = process.env.SHEET_WEBHOOK_TOKEN;
  if (!url || !token) {
    console.error("SHEET_WEBHOOK_URL / SHEET_WEBHOOK_TOKEN not set; payment not logged to the sheet.");
    return "not configured";
  }

  let method = "";
  try {
    const pi = await stripeClient.paymentIntents.retrieve(session.payment_intent, {
      expand: ["payment_method"],
    });
    method = pi.payment_method?.type ?? "";
  } catch (err) {
    console.error("Could not read payment method:", err.message);
  }

  const body = new URLSearchParams({
    action: "paid",
    token,
    stripeId: session.payment_intent || session.id,
    email: session.customer_details?.email || session.customer_email || "",
    name: md.payer_name || session.customer_details?.name || "",
    business: md.business || "",
    honoree: md.honoree || "",
    org: "summit",
    type: md.type,
    tier: md.tier || "",
    amount: String((session.amount_total ?? 0) / 100),
    method,
  });
  const res = await fetchFn(url, { method: "POST", body });
  const text = (await res.text()).trim();
  if (!res.ok || (text !== "ok" && text !== "duplicate")) {
    throw new Error(`Sheet responded ${res.status}: ${text.slice(0, 120)}`);
  }
  return text;
}

export const config = { path: "/api/stripe-webhook" };
