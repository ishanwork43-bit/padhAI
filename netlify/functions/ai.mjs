import { getStore } from '@netlify/blobs';
import { createHandler } from './server/handler.mjs';

// Site-wide state survives deploys and Function cold starts. Never store study content.
export default createHandler({
  store: () => getStore({ name: 'padhai-ai-security-v1', consistency: 'strong' }),
});
export const config = { path: '/api/ai' };
