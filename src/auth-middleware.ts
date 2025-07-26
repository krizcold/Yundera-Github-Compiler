import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
}

// Session management (shared with main app)
declare const activeSessions: Map<string, { timestamp: number; authenticated: boolean }>;
declare const SESSION_DURATION: number;

// Get the AUTH_HASH from environment variable
function getAuthHash(): string | null {
  return process.env.AUTH_HASH || null;
}

// Validate session cookie
function validateSession(sessionId: string): boolean {
  const session = (global as any).activeSessions?.get(sessionId);
  if (!session) return false;
  
  // Check if session is expired
  if (Date.now() - session.timestamp > (global as any).SESSION_DURATION) {
    (global as any).activeSessions?.delete(sessionId);
    return false;
  }
  
  return session.authenticated;
}

// Generate secure session ID
function generateSessionId(): string {
  return require('crypto').randomBytes(32).toString('hex');
}

// Set session cookie
function setSessionCookie(res: Response, sessionId: string) {
  res.setHeader('Set-Cookie', [
    `session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}; Path=/`
  ]);
}

// Validate hash from query parameter, request body, or session cookie
export function validateAuthHash(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const expectedHash = getAuthHash();
  
  // If no AUTH_HASH is set, allow access (development mode)
  if (!expectedHash) {
    req.isAuthenticated = true;
    return next();
  }
  
  // First, check for valid session cookie
  const sessionId = (req as any).cookies?.session;
  if (sessionId && validateSession(sessionId)) {
    req.isAuthenticated = true;
    return next();
  }
  
  // If no valid session, check for hash authentication
  // Check for hash in query parameter (for web UI access)
  const queryHash = req.query.hash as string;
  
  // Check for hash in request body (for API calls)
  const bodyHash = req.body?.hash as string;
  
  // Check for hash in Authorization header (alternative for API calls)
  const authHeader = req.headers.authorization;
  const headerHash = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  
  const providedHash = queryHash || bodyHash || headerHash;
  
  if (!providedHash) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please access this application through CasaOS dashboard.'
    });
  }
  
  if (providedHash !== expectedHash) {
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication hash. Please access this application through CasaOS dashboard.'
    });
  }
  
  // Hash authentication successful - create session
  const newSessionId = generateSessionId();
  (global as any).activeSessions?.set(newSessionId, {
    timestamp: Date.now(),
    authenticated: true
  });
  
  // Set session cookie
  setSessionCookie(res, newSessionId);
  
  req.isAuthenticated = true;
  next();
}

// Middleware specifically for protecting the web UI (index.html)
export function protectWebUI(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const expectedHash = getAuthHash();
  
  // If no AUTH_HASH is set, allow access (development mode)
  if (!expectedHash) {
    console.log('⚠️ No AUTH_HASH set - development mode access allowed');
    return next();
  }
  
  // First, check for valid session cookie
  const sessionId = (req as any).cookies?.session;
  
  if (sessionId && validateSession(sessionId)) {
    console.log('✅ Valid session found - access granted');
    return next();
  }
  
  // If no valid session, check for hash authentication (initial login)
  const queryHash = req.query.hash as string;
  
  if (!queryHash || queryHash !== expectedHash) {
    console.log(`🔒 Web UI access denied - invalid or missing authentication`);
    // Return unauthorized page instead of JSON for web UI
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unauthorized Access</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background-color: #f5f5f5; 
          }
          .container { 
            max-width: 500px; 
            margin: 0 auto; 
            background: white; 
            padding: 30px; 
            border-radius: 10px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          }
          h1 { color: #e74c3c; }
          p { color: #666; margin: 20px 0; }
          .icon { font-size: 64px; color: #e74c3c; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">🔒</div>
          <h1>Unauthorized Access</h1>
          <p>This application requires authentication.</p>
          <p>Please access this application through your CasaOS dashboard.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  // Hash authentication successful for web UI - create session
  console.log('✅ Hash authentication successful - creating session');
  const newSessionId = generateSessionId();
  (global as any).activeSessions?.set(newSessionId, {
    timestamp: Date.now(),
    authenticated: true
  });
  
  // Set session cookie
  setSessionCookie(res, newSessionId);
  
  next();
}