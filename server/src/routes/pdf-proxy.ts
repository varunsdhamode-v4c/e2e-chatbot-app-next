import { Router } from 'express';
import { getDatabricksToken, getCachedCliHost } from '@chat-template/auth';
import { getHostUrl } from '@chat-template/utils';
import path from 'node:path';

export const pdfProxyRouter = Router();

pdfProxyRouter.get('/api/pdf-proxy', async (req, res) => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      return res.status(400).send('Missing url parameter');
    }

    // 1. Extract /Volumes/... path from input URL
    const urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const pathname = urlObj.pathname;
    const volumesIdx = pathname.indexOf('/Volumes/');
    const filePath = volumesIdx !== -1 ? pathname.substring(volumesIdx) : pathname;

    // Extract file name and extension
    const rawFileName = path.basename(filePath) || 'document';
    const fileName = decodeURIComponent(rawFileName);
    const ext = path.extname(fileName).toLowerCase();

    // 2. Build Databricks Files REST API endpoint
    const apiPath = `/api/2.0/fs/files${filePath}`;

    // 3. Resolve host and ensure protocol prefix (https://)
    let activeHost = process.env.DATABRICKS_HOST || getCachedCliHost() || getHostUrl() || '';
    activeHost = activeHost.replace(/\/$/, '');

    if (activeHost && !activeHost.startsWith('http://') && !activeHost.startsWith('https://')) {
      activeHost = `https://${activeHost}`;
    }

    const targetUrl = `${activeHost}${apiPath}`;
    console.log(`[PDF Proxy] Requesting file from: ${targetUrl}`);

    // 4. Resolve authentication token
    // Prioritize DATABRICKS_TOKEN (Service Principal) over x-forwarded-access-token
    let token = process.env.DATABRICKS_TOKEN;

    if (!token) {
      token = await getDatabricksToken();
    }

    if (!token && req.headers['authorization']) {
      token = req.headers['authorization'].replace(/^Bearer\s+/i, '');
    }

    if (!token && req.headers['x-forwarded-access-token']) {
      token = req.headers['x-forwarded-access-token'] as string;
    }

    // 5. Fetch file binary from Databricks API
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
    const buffer = Buffer.from(arrayBuffer);

    // 6. Set appropriate MIME content type
    let contentType = response.headers.get('content-type') || '';
    if (!contentType || contentType.includes('application/octet-stream') || contentType.includes('text/plain')) {
      if (ext === '.docx') {
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (ext === '.pdf') {
        contentType = 'application/pdf';
      } else if (ext === '.pptx' || ext === '.ppt') {
        contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      } else {
        contentType = 'application/octet-stream';
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', buffer.length.toString());
    return res.send(buffer);
  } catch (error) {
    console.error('[PDF Proxy Exception]:', error);
    return res.status(500).send('Error proxying document');
  }
});