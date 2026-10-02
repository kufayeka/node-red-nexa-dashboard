# Nexa Link: screens ⇄ Node-RED flows

A Nexa screen's logic runs in the browser. Anything that needs a secret (database credentials, API keys) or real server work belongs in a **Node-RED flow** instead. Nexa Link connects the two.

| On the screen (Logic) | In the flow (Node-RED) | What happens |
| --- | --- | --- |
| **Request** (2 outputs: answer, error) | **from Nexa** → … → **to Nexa** | The page sends `msg.payload` and waits for the flow's answer. |
| **To Node-RED** | **from Nexa** | The page sends `msg.payload`. Nothing comes back. |
| **From Node-RED** (a source) | **to Nexa** | The flow pushes `msg.payload` to every page that has this screen open. |

Both sides pick the same **channel**, a `kufayeka-nexa-channel` config node. On the screen, the channel dropdown lists every channel in the Node-RED editor, deployed or not.

## Channel settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Max size | 32 MB | The largest payload, in either direction. A bigger one gets an error on both sides. |
| Timeout | 10 s | How long a Request waits. After that, the Request takes its error output (`timeout: …`). |
| Delivery | Queue | **Queue**: every message reaches every page, in order (data, charts). **Latest**: a page that can't keep up gets only the newest message (status). |
| Retain | off | Keeps the last pushed message, so a page that opens later gets it right away. |
| Compression | off | **Auto** deflates payloads over 16 KB (JSON shrinks 5–8×). Use it on WAN / 4G / VPN, not on a LAN. Each payload is compressed once, whatever the number of pages. The browser inflates natively. |

## Messages

**from Nexa** outputs:
- `payload`: JSON, or a `Buffer` if the page sent binary.
- `topic`: the channel name.
- `_nexa`: `{channel, client, screen, ip}`, plus `reqId` for a Request. Keep it on the message; **to Nexa** needs it to answer.

**to Nexa**, "Send to":
- **Auto** (default): answers the request if `msg._nexa.reqId` is set; otherwise pushes to every page on the channel.
- **Every page**: always pushes to every page on the channel.
- **Only the page in msg._nexa**: pushes to the one page the message came from.

`msg.error` (a string, an Error, or what a Catch node sets) answers the request with an error, and the page's Request takes its error output. A Buffer or typed array is sent as binary; on the page, `msg.payload` is an `ArrayBuffer`.

Example, 10 000 products from a database:

```
[Request: products] ── page ──▶ [from Nexa: products] → [postgres: SELECT … LIMIT $1] → [to Nexa (auto)]
```

## How it is built (and why it can't slow the tags)

```
Browser ──WS /nexa/_io   ──▶ screen worker   (tags, UI: unchanged)
Browser ──WS /nexa/_link ──▶ link worker     (own thread, own port)
                                 │ postMessage, ArrayBuffer transferred (not copied)
                                 ▼
                             main thread: from Nexa / to Nexa → the flow
```

- **Own TCP connection, own thread.** The link worker listens on `nexaDashboard.linkWorkerPort`. The default is the screen port + 1 (1882). Open that port too if a firewall sits in front. The worker runs only while at least one channel is deployed.
- **Finding the link:** the page asks the screen worker `GET /nexa/_link-info` for `{port, token}`. The token is an HMAC with a secret only the two workers know. The link worker refuses a socket without a valid token, or from another site's page (`Origin`).
- **Big payloads:** serialized **once** on the main thread (`JSON.stringify` or the Buffer itself) into an ArrayBuffer of their own, then transferred to the worker. The worker never parses them. It cuts them into 64 KB frames and sends while the socket has less than 256 KB queued, round robin between messages, so a 20 MB push doesn't hold back a small answer. The page writes the frames into one buffer and parses once.
- **Limits:** 8 requests in flight per page; a late or second answer is refused (an error on the **to Nexa** node); a page that leaves drops its pending requests; a page that can't keep up on a Queue channel gets a `gap` notice instead of unbounded memory.
- **Wire format:** `src/shared/link/frame.js` (one copy, used by the worker and bundled into the page). State and pacing: `src/server/link/hub.js`. Worker: `src/server/workers/link-worker.js`. Main-thread half: `src/server/link/bridge.js`. Nodes: `nodes/nexa-link.js`. Page: `src/runtime/io/link.js` and `src/runtime/logic/nodes/link-nodes.js`.

**What is still shared:** the network, and the browser's main thread (parsing a huge JSON). For tens of MB, page the data (send `page` / `limit` in the Request) or send binary.

**The tags don't wait for the main thread either.** Since 2026-10-03 they go straight from the Sparkplug worker to the screen worker (ARCHITECTURE.md §3). While a flow blocks the main thread for 500 ms, the worst tag gap stays about 54 ms. `test/link-e2e.test.js` checks this.

## Tests

| File | What |
| --- | --- |
| `test/link-hub.test.js` | Frame codec, reassembly, limits, and the hub (requests, timeout, retain, latest, queue, pacing, round robin, compression), without sockets. In `run-all.js`. |
| `test/link-worker-integration.test.js` | The real worker, the real nodes under a fake RED, and a real WebSocket: token / Origin, 10 000 products, error answer, timeout, binary, push, retain, compression, redeploy, stop. In `run-all.js`. |
| `test/link-e2e.test.js` | A live page of an isolated Node-RED (1899 / 1898 / 1897), a broker, and an edge with a 20 ms tag: Request, a 20 MB push, and the tag frame gaps measured in the page, idle, during the 20 MB, and while a flow blocks the main thread for 500 ms. Run by hand. |
