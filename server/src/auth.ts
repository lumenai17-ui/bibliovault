/**
 * BiblioVault AI — Authentication Module
 * Phase 11.2: bcrypt password hashing + JWT session management
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  getUserByEmail,
  getUserById,
  createUser,
  updateLastLogin,
  updateUserPassword,
  type UserRow,
} from './db.js';

// ── Configuration ──
const JWT_SECRET = process.env.JWT_SECRET || 'bibliovault-dev-secret-change-in-production-2026';
const JWT_EXPIRES_IN = '7d'; // Sessions last 7 days
const BCRYPT_ROUNDS = 12;
const COOKIE_NAME = 'bv_session';

export { COOKIE_NAME };

// ── Password Utilities ──

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

// ── JWT Utilities ──

export interface JwtPayload {
  userId: string;
  email: string;
  plan: string;
}

export function generateJWT(user: Pick<UserRow, 'id' | 'email' | 'plan'>): string {
  return jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan } as JwtPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyJWT(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Cookie Configuration ──

export function getSessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAge ?? 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };
}

// ── Auth Operations ──

export interface AuthResult {
  success: boolean;
  user?: Omit<UserRow, 'password_hash'>;
  token?: string;
  error?: string;
}

export async function registerUser(email: string, password: string, displayName: string): Promise<AuthResult> {
  // Validate
  if (!email || !password) {
    return { success: false, error: 'Email y contraseña son requeridos.' };
  }
  if (password.length < 6) {
    return { success: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  // Check if email already exists
  const existing = await getUserByEmail(email.toLowerCase().trim());
  if (existing) {
    return { success: false, error: 'Ya existe una cuenta con ese email.' };
  }

  // Create user
  const id = uuidv4();
  const passwordHash = await hashPassword(password);
  await createUser(id, email.toLowerCase().trim(), passwordHash, displayName.trim() || 'Usuario');
  
  const user = (await getUserById(id))!;
  const token = generateJWT(user);
  await updateLastLogin(id);

  const { password_hash: _, ...safeUser } = user;
  return { success: true, user: safeUser, token };
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  if (!email || !password) {
    return { success: false, error: 'Email y contraseña son requeridos.' };
  }

  const user = await getUserByEmail(email.toLowerCase().trim());
  if (!user) {
    return { success: false, error: 'Credenciales inválidas.' };
  }

  // Check if the user has a placeholder hash (from seed), allow any password for dev
  if (!user.password_hash.startsWith('$2') ) {
    // First real login: set the password
    const hash = await hashPassword(password);
    await updateUserPassword(user.id, hash);
  } else {
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return { success: false, error: 'Credenciales inválidas.' };
    }
  }

  const token = generateJWT(user);
  await updateLastLogin(user.id);

  const { password_hash: _, ...safeUser } = user;
  return { success: true, user: safeUser, token };
}

export async function getAuthenticatedUser(token: string): Promise<Omit<UserRow, 'password_hash'> | null> {
  const payload = verifyJWT(token);
  if (!payload) return null;

  const user = await getUserById(payload.userId);
  if (!user) return null;

  const { password_hash: _, ...safeUser } = user;
  return safeUser;
}

