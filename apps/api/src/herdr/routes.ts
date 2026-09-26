import { Hono } from 'hono';
import { type AuthVariables, requireUser } from '../lib/auth-guard';
import { allAgents } from './state';

/** Agents across all connected machines, attention first. */
export const agentRoutes = new Hono<{ Variables: AuthVariables }>().use(requireUser).get('/', (c) => c.json({ agents: allAgents() }));
