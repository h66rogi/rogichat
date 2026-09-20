import { contract, enumeration, object } from '../../../common/openapi/schema.js';
export const healthDocs = {
  live: () => contract({ id: 'getLiveness', summary: '프로세스 생존 확인', auth: 'none', errors: [], response: object({ status: enumeration('ok') }) }),
  ready: () => contract({ id: 'getReadiness', summary: '현재 DB 및 스키마 준비 상태 확인', auth: 'none', errors: [], response: object({ status: enumeration('ready') }) }),
};
