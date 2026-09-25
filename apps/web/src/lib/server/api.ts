import { env } from '$env/dynamic/private';

export const apiUrl = env.API_URL ?? 'http://localhost:3000';
