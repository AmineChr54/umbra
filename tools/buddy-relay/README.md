# Buddy relay

A tiny Cloudflare Worker (+ one Durable Object class) behind the `buddy` widget. It pairs two people with a one-time
code (8 characters, valid 10 minutes, single use) and tells each whether the other sent a heartbeat recently.
It stores random ids, secrets and timestamps only. Rooms nobody has used for 30 days delete themselves.

## Deploy (once, free plan)

```powershell
cd tools/buddy-relay
npx wrangler login
npx wrangler deploy        # prints https://umbra-buddy-relay.<your-subdomain>.workers.dev
```

Then put that host in `widgets/buddy/main.js` (`RELAY`) and `widgets/buddy/widget.json` (`permissions.hosts`), bump the
widget version, and run `node scripts/catalog.mjs`. Both friends need the widget version that points at the same relay.

## Try it locally

`npx wrangler dev --port 8799`, then `curl "http://127.0.0.1:8799/pair?new=1"` (the widget itself needs HTTPS).

## Limits

Workers Free allows 100k requests per day across everything, and one heartbeat is one request: at 60 s that is about
1,440 a day per person, so roughly 70 people. Consider a Cloudflare rate-limit rule on `/pair?new=1` if you publish the relay.
