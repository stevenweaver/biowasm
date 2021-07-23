// The biowasm CDN is hosted using Cloudflare Worker Sites where CDN files
// are stored in a key-value store (Cloudflare Worker KV). For example:
//     key=samtools/1.10/samtools.wasm --> value=<samtools.wasm contents>
// 
// A Cloudflare Worker (a serverless function) is the entry point for
// retrieving those files from the key-value store. This index.js file
// defines the code for that entry point. The code is mostly using the
// Cloudflare Workers Site template, but modified to enable CORS (so that
// biowasm modules can be loaded from non-biowasm.com domains!) and to
// log basic stats about the number of downloads per module.

import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

const URL_PREFIX = "/v2";

// Function called when we go to cdn.biowasm.com/v2/
addEventListener("fetch", event => {
  let response = {};

  // Process user request
  try {
    response = handleEvent(event);
  } catch (e) {
    response = new Response("Internal Error", { status: 500 });
  }

  // Log basic stats about number of times a .js file was requested *after* we return a response to the user.
  // Documentation: https://github.com/Logflare/cloudflare-app/blob/e5bb250b13d3fbad35e3f87cbcb7e32b35984ee6/workers/utils.js#L18
  let url = new URL(event.request.url);
  if(url.host.startsWith("cdn") && url.host.endsWith(".biowasm.com") && url.pathname.endsWith(".js")) {
    async function logEvent(path) {
      const uuid = await fetch("https://csprng.xyz/v1/api?length=10").then(d => d.json()).then(d => d.Data);
      // ISO Date Format: <YYYY-MM-DDTHH:mm:ss.sssZ> --> want YYYY-MM-DD
      // Path format: /v2/<tool>/<version>/<program>.js
      let key = `raw:${new Date().toISOString().split("T").shift()}:${path.split("/")[2]}:${uuid}`;
      // Log event
      await LOGS.put(key, "");
    }
    event.waitUntil(logEvent(url.pathname));
  }

  // Return result
  event.respondWith(response);
})

async function handleEvent(event) {
  // Retrieve KV value given a path
  try {
    let response = await getAssetFromKV(event, {
      mapRequestToAsset: handlePrefix(),
      cacheControl: {
        browserTTL: 604800,  // 1 week (default: null)
        edgeTTL: 172800,     // 2 days (default: 2 days)
        bypassCache: false   // Do not bypass Cloudflare's cache (default: false)
      }
    });

    // Enable CORS
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  
  // On error, show a 404 error
  } catch (e) {
    return new Response("404 Not Found", { status: 404 });
  }
}

function handlePrefix() {
  return request => {
    // If path looks like a directory append index.html
    // e.g. If path is /about/ -> /about/index.html
    const parsedUrl = new URL(request.url);
    let pathname = parsedUrl.pathname;
    if (pathname.endsWith("/")) {
      pathname = pathname.concat("index.html");
    }
    pathname = pathname.replace(URL_PREFIX, "/");

    parsedUrl.pathname = pathname;
    return new Request(parsedUrl.toString(), request);
  }
}
