import { Request, Response, NextFunction } from 'express';
import { validateAppToken, AppToken } from './app-tokens';

export interface AppAuthenticatedRequest extends Request {
  appToken?: AppToken;
}

export function validateAppTokenMiddleware(req: AppAuthenticatedRequest, res: Response, next: NextFunction) {
  const appTokenHeader = req.headers['x-app-token'] as string;

  if (!appTokenHeader) {
    return res.status(401).json({
      success: false,
      message: 'App authentication required. Please provide X-App-Token header.'
    });
  }

  const appToken = require('./app-tokens').validateAppToken(appTokenHeader);

  if (!appToken) {
    return res.status(401).json({
      success: false,
      message: 'Invalid app token. Please verify your authentication credentials.'
    });
  }

  req.appToken = appToken;
  console.log(`🔑 App authenticated: ${appToken.appName} (${appToken.repositoryId})`);

  next();
}