import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

export function channelDoc(id:string,summary:string,auth:'none'|'read'|'write'='none',status=200,hasId=false):MethodDecorator {
  const security=auth==='none'?[]:auth==='write'?[{browserSession:[],csrf:[]},{nativeBearer:[],nativeClient:[]}]:[{browserSession:[]},{nativeBearer:[],nativeClient:[]}];
  return applyDecorators(ApiOperation({operationId:id,summary,description:`후로기 채널 ${summary}.`,security}),
    ...(hasId?[ApiParam({name:'id',schema:{type:'integer',minimum:1}})]:[]),
    ApiResponse({status,description:status===204?'처리 완료. 본문 없음.':'처리 결과'}),
    ApiResponse({status:400,description:'입력 형식 오류'}),
    ...(auth==='none'?[]:[ApiResponse({status:401,description:'인증 필요'}),ApiResponse({status:403,description:'권한 없음'})]),
    ApiResponse({status:404,description:'대상을 찾을 수 없음'}),
    ApiResponse({status:503,description:'일시적으로 사용할 수 없음'}));
}
