import '../../../../shared/node-binding';
import { handleAgentRequest } from '../../../../shared/receiver';

// Published crypto-wasm has a Node loader. Do not silently run it in Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleAgentRequest(request, process.env);
export const POST = GET;
