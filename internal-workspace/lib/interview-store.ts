import {files,type Identity} from './cyber-store';
import {allCareer} from './tracker-store';
import {deleteCareer} from './career-store';
import {mediaExpired,type PracticeMedia} from './interview-practice';
export async function cleanupPracticeMedia(user:Identity,sessionId?:string){const rows=await allCareer<PracticeMedia>(user,'practiceMedia');for(const row of rows)if((sessionId&&row.data.sessionId===sessionId)||(!sessionId&&mediaExpired(row.data))){await files().delete(row.data.key);await deleteCareer(user,'practiceMedia',row.id,row.version);}}
