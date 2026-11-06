import {identity,response,failure} from '@/lib/cyber-store';
import {privateJson} from '@/lib/career-store';
import {extensionImportSchema} from '@/lib/extension-protocol';
import {importExtensionJob} from '@/lib/extension-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return response(await importExtensionJob(await identity(request),extensionImportSchema.parse(await privateJson(request))));}catch(e){return failure(e);}}
