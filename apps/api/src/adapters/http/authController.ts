import { Hono } from 'hono';
import { AuthController } from '../../adapters/http/AuthController';

export const authController = new Hono();
// routes registration will be added later
