import {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import env from '../env';

export type AuthedRequest = Request & {userId?: number; phone?: string};

export type JwtPayload = {sub: number; phone: string};

export function signToken(userId: number, phone: string): string {
  return jwt.sign({sub: userId, phone}, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Gate a route behind a valid Bearer token. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({error: 'Missing authorization token.'});
  }
  try {
    const decoded = jwt.verify(header.slice(7), env.jwtSecret) as unknown as JwtPayload;
    req.userId = decoded.sub;
    req.phone = decoded.phone;
    next();
  } catch {
    return res.status(401).json({error: 'Invalid or expired token.'});
  }
}
