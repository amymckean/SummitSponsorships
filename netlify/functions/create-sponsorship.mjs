import Stripe from "stripe";

let stripe;

const REQUIRED_ENV = ["STRIPE_SECRET_KEY", "SITE_URL"];

// Summit Fastpitch sponsorship levels. Prices live here, on the server, so what gets charged
// can never be changed from the browser. "min" levels accept any amount at or above the minimum.
// Summit Fastpitch levels, as on playsummit.org/sponsor.
const SUMMIT_TIERS = {
  rise: { label: "Rise", amount: 250 },
  trailblazer: { label: "Trailblazer", amount: 750 },
  peak: { label: "Peak", amount: 1000 },
  founding: { label: "Founding Sponsor", min: 1500 },
};
const MAX_AMOUNT = 20000;
const DONATION_MIN = 5;

const SUMMIT_LINE =
  "Summit United is a 501(c)(3) nonprofit (EIN 41-489-3932). Donations may be tax-deductible to the extent allowed by law.";

// Builds the Checkout Session parameters, or returns { error } if the input
// isn't valid. Kept separate from the handler so it can be tested without
// calling Stripe. No card surcharge: the receipt amount equals the sponsor's gift.
export function buildCheckoutParams(body, siteUrl) {
  const { tier, business, name, email, amount, honoree } = body ?? {};
  // This site is Summit Fastpitch only, so every payment is tagged org=summit.
  const isSummit = true;
  const org = "summit";

  const isDonation = tier === "donation";
  const t = isDonation ? { label: "Donation", min: DONATION_MIN } : SUMMIT_TIERS[tier];
  if (!t) return { error: "Choose a sponsorship level." };
  
  // The business name is optional for donations and sponsorships alike, so individuals can give too.
  const biz = typeof business === "string" ? business.trim().slice(0, 120) : "";

  // Optional "in honor of" name on a donation. It is recorded for the club's records only: the gift is to the organization,
  // which keeps control of how it is used, and it never reduces any player's fees.
  const honor = isDonation && typeof honoree === "string" ? honoree.trim().slice(0, 120) : "";

  const payer = typeof name === "string" ? name.trim().slice(0, 120) : "";
  if (!payer) return { error: "Name is required." };

  if (!email || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return { error: "A valid email is required." };
  }
  const normalizedEmail = email.trim().toLowerCase();

  let dollars;
  if (t.amount) {
    dollars = t.amount;
  } else {
    dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < t.min || dollars > MAX_AMOUNT) {
      return { error: `Enter an amount between $${t.min.toLocaleString("en-US")} and $${MAX_AMOUNT.toLocaleString("en-US")}.` };
    }
  }
  const cents = Math.round(dollars * 100);

  return {
    params: {
      mode: "payment",
      customer_email: normalizedEmail,
      customer_creation: "always",
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name: isDonation
                ? `Donation in support of ${isSummit ? "Summit Fastpitch" : "Voltage Baseball Club"}`
                : `${isSummit ? "Summit" : "VBC"} Sponsorship — ${t.label}`,
              description: SUMMIT_LINE,
            },
          },
        },
      ],
      payment_intent_data: {
        description: isDonation ? `${isSummit ? "Summit" : "VBC"} donation — ${payer}` : `${isSummit ? "Summit" : "VBC"} sponsorship — ${t.label} — ${biz || payer}`,
        receipt_email: normalizedEmail,
        // org/type/tier let one Stripe export separate sponsorship income from
        // player fees (which are tagged org=voltage with no type).
        metadata: {
          org,
          type: isDonation ? "donation" : "sponsorship",
          tier,
          business: biz || "",
          payer_name: payer,
          ...(honor ? { honoree: honor } : {}),
          base_amount: (cents / 100).toFixed(2),
        },
      },
      // Session-level copy of the tags so the webhook can read them directly.
      metadata: {
        org,
        type: isDonation ? "donation" : "sponsorship",
        tier,
        business: biz || "",
        payer_name: payer,
        ...(honor ? { honoree: honor } : {}),
      },
      custom_text: { submit: { message: SUMMIT_LINE } },
      success_url: `${siteUrl}/?status=success`,
      cancel_url: `${siteUrl}/?status=cancelled`,
    },
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    return json({ error: "Server misconfigured. Contact the site admin." }, 500);
  }

  stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const built = buildCheckoutParams(body, process.env.SITE_URL);
  if (built.error) return json({ error: built.error }, 400);

  try {
    const session = await stripe.checkout.sessions.create(built.params);
    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe Checkout Session creation failed:", err);
    return json({ error: "Something went wrong creating your checkout session." }, 500);
  }
};

export const config = { path: "/api/create-sponsorship" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
