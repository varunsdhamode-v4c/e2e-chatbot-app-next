// Load environment variables FIRST before any other imports
import './env';

import express, {
  type Request,
  type Response,
  type NextFunction,
  type Express,
} from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chatRouter } from './routes/chat';
import { storeMessageMeta } from './lib/message-meta-store';
import { historyRouter } from './routes/history';
import { sessionRouter } from './routes/session';
import { messagesRouter } from './routes/messages';
import { configRouter } from './routes/config';
import { feedbackRouter } from './routes/feedback';
import { ChatSDKError } from '@chat-template/core/errors';
import { pdfProxyRouter } from './routes/pdf-proxy';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app: Express = express();
const isDevelopment = process.env.NODE_ENV !== 'production';

// Development environment variable fallbacks for local execution
if (isDevelopment) {
  if (!process.env.DATABRICKS_HOST) {
    process.env.DATABRICKS_HOST = 'https://dbc-2d78c719-5ef2.cloud.databricks.com';
  }
  if (!process.env.DATABRICKS_CONFIG_PROFILE) {
    process.env.DATABRICKS_CONFIG_PROFILE = 'agent-dev';
  }
  if (!process.env.DATABRICKS_SERVING_ENDPOINT) {
    process.env.DATABRICKS_SERVING_ENDPOINT = 'ka-bd75d20a-endpoint';
  }
}

// Dynamic Port Handling: Databricks Apps assigns process.env.PORT at runtime (e.g. 8080)
// For local development, default to 3001 to prevent collisions with Vite (3000)
const PORT = process.env.PORT || process.env.CHAT_APP_PORT || (isDevelopment ? 3001 : 3000);

// CORS configuration
app.use(
  cors({
    origin: isDevelopment ? 'http://localhost:3000' : true,
    credentials: true,
  }),
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Register PDF Proxy Endpoint
app.use(pdfProxyRouter);

// Health check endpoint (for Playwright tests & Databricks App container checks)
app.get('/ping', (_req, res) => {
  res.status(200).send('pong');
});

// API routes
app.use('/api/chat', chatRouter);
app.use('/api/history', historyRouter);
app.use('/api/session', sessionRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/config', configRouter);
app.use('/api/feedback', feedbackRouter);

// Agent backend proxy (optional)
// If API_PROXY is set, proxy /invocations requests to the agent backend
const agentBackendUrl = process.env.API_PROXY;
if (agentBackendUrl) {
  console.log(`✅ Proxying /invocations to ${agentBackendUrl}`);
  app.all('/invocations', async (req: Request, res: Response) => {
    try {
      const forwardHeaders = { ...req.headers } as Record<string, string>;
      forwardHeaders['content-length'] = undefined;

      const response = await fetch(agentBackendUrl, {
        method: req.method,
        headers: forwardHeaders,
        body:
          req.method !== 'GET' && req.method !== 'HEAD'
            ? JSON.stringify(req.body)
            : undefined,
      });

      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Stream the response body
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (error) {
      console.error('[/invocations proxy] Error:', error);
      res.status(502).json({
        error: 'Proxy error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

// Serve static files in production (Databricks Apps Deployment)
if (!isDevelopment) {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);

  if (err instanceof ChatSDKError) {
    const response = err.toResponse();
    return res.status(response.status).json(response.json);
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
  });
});

// Start MSW mock server in test mode or start backend server
async function startServer() {
  if (process.env.PLAYWRIGHT === 'True') {
    console.log('[Test Mode] Starting MSW mock server for API mocking...');
    try {
      // Dynamically import MSW setup from tests directory
      const modulePath = path.join(
        dirname(dirname(__dirname)),
        'tests',
        'api-mocking',
        'api-mock-server.ts',
      );
      console.log('[Test Mode] Attempting to load MSW from:', modulePath);

      const { mockServer } = await import(modulePath);

      mockServer.listen({
        onUnhandledRequest: (request: Request) => {
          console.warn(
            `[MSW] Unhandled ${request.method} request to ${request.url}`,
          );
        },
      });

      console.log('[Test Mode] MSW mock server started successfully');
      console.log(
        '[Test Mode] Registered handlers:',
        mockServer.listHandlers().length,
      );

      // Import captured request utilities for testing context injection
      const handlersPath = path.join(
        dirname(dirname(__dirname)),
        'tests',
        'api-mocking',
        'api-mock-handlers.ts',
      );
      const {
        getCapturedRequests,
        resetCapturedRequests,
        getLastCapturedRequest,
        resetMlflowAssessmentStore,
        getLastServingRequestHeaders,
      } = await import(handlersPath);

      // Test-only endpoint to get captured requests
      app.get('/api/test/captured-requests', (_req, res) => {
        res.json(getCapturedRequests());
      });

      // Test-only endpoint to get the last captured request
      app.get('/api/test/last-captured-request', (_req, res) => {
        const lastRequest = getLastCapturedRequest();
        if (lastRequest) {
          res.json(lastRequest);
        } else {
          res.status(404).json({ error: 'No captured requests' });
        }
      });

      // Test-only endpoint to reset captured requests
      app.post('/api/test/reset-captured-requests', (_req, res) => {
        resetCapturedRequests();
        res.json({ success: true });
      });

      // Test-only endpoint to reset MLflow assessment store
      app.post('/api/test/reset-mlflow-store', (_req, res) => {
        resetMlflowAssessmentStore();
        res.json({ success: true });
      });

      // Test-only endpoint to read headers from the last serving endpoint request
      app.get('/api/test/serving-request-headers', (_req, res) => {
        res.json(getLastServingRequestHeaders());
      });

      console.log(
        '[Test Mode] Test endpoints for context injection registered',
      );
    } catch (error) {
      console.error('[Test Mode] Failed to start MSW:', error);
      console.error(
        '[Test Mode] Error details:',
        error instanceof Error ? error.stack : error,
      );
    }

    app.post('/api/test/store-message-meta', (req, res) => {
      const { messageId, chatId, traceId } = req.body as {
        messageId: string;
        chatId: string;
        traceId: string | null;
      };
      storeMessageMeta(messageId, chatId, traceId ?? null);
      res.json({ success: true });
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
    console.log(`Environment: ${isDevelopment ? 'development' : 'production'}`);
  });
}

startServer();

export default app;