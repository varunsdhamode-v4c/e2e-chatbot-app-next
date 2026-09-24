import { Router } from 'express';
import { getDatabricksToken, getCachedCliHost } from '@chat-template/auth';
import { getHostUrl } from '@chat-template/utils';

export const pdfProxyRouter = Router();

pdfProxyRouter.get('/api/pdf-proxy', async (req, res) => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      return res.status(400).send('Missing url parameter');
    }

    // 1. Parse URL and extract the /Volumes/... path
    const urlObj = new URL(rawUrl);
    const pathname = urlObj.pathname;

    const volumesIdx = pathname.indexOf('/Volumes/');
    const filePath = volumesIdx !== -1 ? pathname.substring(volumesIdx) : pathname;

    // 2. Build standard Unity Catalog Files REST API path (/api/2.0/fs/files/Volumes/...)
    const apiPath = `/api/2.0/fs/files${filePath}`;

    // 3. Resolve active workspace host:
    // Priority 1: Environment variable injected by Databricks Apps
    // Priority 2: Local CLI cached host or fallback host URL
    const activeHost = process.env.DATABRICKS_HOST || getCachedCliHost() || getHostUrl();
    const targetUrl = `${activeHost.replace(/\/$/, '')}${apiPath}`;

    console.log('[PDF Proxy] Requesting file from:', targetUrl);

    // 4. Resolve authentication token:
    // Priority 1: Token forwarded in headers by Databricks Apps (x-forwarded-access-token / Authorization)
    // Priority 2: Token from environment variable (DATABRICKS_TOKEN)
    // Priority 3: Local CLI OAuth token fallback
    let token =
      (req.headers['x-forwarded-access-token'] as string) ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
      process.env.DATABRICKS_TOKEN;

    if (!token) {
      token = await getDatabricksToken();
    }

    // 5. Fetch PDF binary from Databricks API
    const response = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PDF Proxy Error ${response.status}]:`, errorText);
      return res.status(response.status).send(`Databricks Error: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // 6. Return inline PDF stream
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length.toString());

    return res.send(pdfBuffer);
  } catch (error) {
    console.error('[PDF Proxy Exception]:', error);
    return res.status(500).send('Error proxying PDF document');
  }
});